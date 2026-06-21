/**
 * prediction.ts — Motor de Previsão Inteligente v2
 *
 * O coração do BusTracker. Prevê quando o ônibus vai chegar no ponto
 * do usuário usando um algoritmo multi-fatorial que aprende com o histórico.
 *
 * Fatores considerados (v2):
 * - Recência: dados recentes pesam mais (decaimento exponencial)
 * - Dia da semana: mesmo dia pesa muito mais que dias diferentes
 * - Horário: horários similares pesam mais (kernel Gaussiano)
 * - Faixa horária: mesmo período do dia (rush, entrepico) recebe bônus
 * - Outliers: registros anômalos são detectados e filtrados via IQR
 * - Tendência: regressão linear detecta se atrasos estão subindo/descendo
 * - Cold Start: heurísticas melhores com 0-3 registros
 * - Intervalo de confiança: mostra faixa de incerteza (±Xmin)
 */

import type {
  Schedule,
  Preset,
  TripRecord,
  Prediction,
  DayType,
  ConfidenceInterval,
} from '../types'

import {
  timeToMinutes,
  timeDiffMinutes,
  addMinutes,
  currentTime,
  daysSince,
} from '../utils/time'

import {
  detectOutliers,
  calcTimeBandWeight,
  linearRegression,
  calculateConfidenceInterval,
  calculateLineReliability,
} from './prediction-utils'

/** Constantes do motor de previsão v2 (exportadas pra permitir tuning) */
export const PREDICTION_CONFIG = {
  // Pesos de recência
  RECENCY_DECAY: 0.05,            // Taxa de decaimento diário

  // Pesos de dia da semana
  DAY_MATCH_WEIGHT: 1.0,          // Mesmo dia da semana
  DAY_ADJACENT_WEIGHT: 0.5,       // Dia adjacente (±1)
  DAY_SAME_TYPE_WEIGHT: 0.3,      // Mesmo tipo de dia (weekday/weekend) mas dia diferente
  DAY_DIFFERENT_TYPE_WEIGHT: 0.1,  // Tipo de dia diferente

  // Kernel Gaussiano de horário
  TIME_SIGMA: 60,                 // Desvio padrão em minutos pro kernel Gaussiano

  // Blending com estimativa manual
  BLEND_THRESHOLD: 5.0,           // Peso total mínimo pra confiar só nos dados

  // Confiança
  MIN_WEIGHT_FULL_CONFIDENCE: 10, // Peso total pra 100% data confidence
  CONSISTENCY_MAX_STDDEV: 15,     // Desvio padrão máximo (min) pro bônus de consistência
  COLD_START_MAX_CONFIDENCE: 25,  // Confiança máxima durante cold start

  // Tendência (regressão linear)
  TREND_WINDOW_DAYS: 14,          // Janela de dias pra calcular tendência
  TREND_MIN_RSQUARED: 0.3,       // R² mínimo pra considerar tendência significativa
  TREND_BLEND_FACTOR: 0.3,       // Quanto a tendência influencia a previsão (0-1)
} as const

// ─── Funções de Peso ────────────────────────────────────────────────────────

/**
 * Calcula o peso de recência de um registro.
 * Dados mais recentes têm peso maior (decaimento exponencial).
 * Ex: 30 dias atrás → ~22% de peso, 60 dias → ~5%
 */
export function calcRecencyWeight(daysSinceRecord: number): number {
  return Math.exp(-PREDICTION_CONFIG.RECENCY_DECAY * daysSinceRecord)
}

/**
 * Calcula o peso baseado no dia da semana.
 * Mesmo dia pesa 1.0, dia adjacente 0.5, mesmo tipo 0.3, tipo diferente 0.1.
 * Usa adjacência circular (domingo=0 e sábado=6 são adjacentes).
 */
export function calcDayWeight(
  recordDayOfWeek: number,
  targetDayOfWeek: number,
  recordDayType: DayType,
  targetDayType: DayType
): number {
  // Mesmo dia da semana
  if (recordDayOfWeek === targetDayOfWeek) {
    return PREDICTION_CONFIG.DAY_MATCH_WEIGHT
  }

  // Calcula distância circular entre dias (0-6)
  const diff = Math.abs(recordDayOfWeek - targetDayOfWeek)
  const circularDiff = Math.min(diff, 7 - diff)

  // Dia adjacente (±1 considerando circularidade)
  if (circularDiff === 1) {
    return PREDICTION_CONFIG.DAY_ADJACENT_WEIGHT
  }

  // Mesmo tipo de dia mas dia diferente
  if (recordDayType === targetDayType) {
    return PREDICTION_CONFIG.DAY_SAME_TYPE_WEIGHT
  }

  // Tipo de dia completamente diferente
  return PREDICTION_CONFIG.DAY_DIFFERENT_TYPE_WEIGHT
}

/**
 * Calcula o peso baseado na similaridade de horário usando kernel Gaussiano.
 * Horários dentro de 1 hora têm peso significativo.
 * Horários com 3+ horas de diferença têm peso quase zero.
 */
export function calcTimeWeight(recordTime: string, targetTime: string): number {
  const timeDiff = Math.abs(timeToMinutes(recordTime) - timeToMinutes(targetTime))
  const sigma = PREDICTION_CONFIG.TIME_SIGMA
  return Math.exp(-(timeDiff * timeDiff) / (2 * sigma * sigma))
}

// ─── Motor de Previsão v2 ───────────────────────────────────────────────────

/**
 * Interface interna pra armazenar dados de cada registro com seu peso calculado.
 */
interface WeightedRecord {
  offset: number            // Offset real: quantos min depois da tabela o ônibus chegou
  tripDuration: number | null // Duração da viagem (null se não completou)
  weight: number            // Peso combinado deste registro
  isOutlier: boolean        // Se este registro foi marcado como outlier
  daysSinceRecord: number   // Quantos dias desde o registro (pra regressão)
}

/**
 * Calcula os pesos pra todos os registros relevantes.
 * Cada registro recebe um peso baseado em recência × dia × horário × faixa horária.
 * Outliers manuais (marcados pelo usuário) recebem peso 0.
 */
function calculateWeightedRecords(
  records: TripRecord[],
  targetTime: string,
  targetDayOfWeek: number,
  targetDayType: DayType
): WeightedRecord[] {
  return records.map((record) => {
    // Se já foi marcado manualmente como outlier, peso 0
    if (record.isOutlier) {
      const offset = timeDiffMinutes(record.scheduledDeparture, record.busArrivedAt)
      const tripDuration = record.arrivedAtDestination
        ? timeDiffMinutes(record.busArrivedAt, record.arrivedAtDestination)
        : null
      return { offset, tripDuration, weight: 0, isOutlier: true, daysSinceRecord: daysSince(record.date) }
    }

    // Offset real: quantos minutos o ônibus demorou além do horário da tabela
    const offset = timeDiffMinutes(record.scheduledDeparture, record.busArrivedAt)

    // Duração da viagem (só se tem dado de chegada no destino)
    const tripDuration = record.arrivedAtDestination
      ? timeDiffMinutes(record.busArrivedAt, record.arrivedAtDestination)
      : null

    // Calcula cada fator de peso
    const recencyWeight = calcRecencyWeight(daysSince(record.date))
    const dayWeight = calcDayWeight(record.dayOfWeek, targetDayOfWeek, record.dayType, targetDayType)
    const timeWeight = calcTimeWeight(record.scheduledDeparture, targetTime)
    const timeBandWeight = calcTimeBandWeight(record.scheduledDeparture, targetTime)

    // Peso combinado: multiplicação dos 4 fatores
    const weight = recencyWeight * dayWeight * timeWeight * timeBandWeight

    return { offset, tripDuration, weight, isOutlier: false, daysSinceRecord: daysSince(record.date) }
  })
}

/**
 * Calcula média ponderada de um conjunto de valores com pesos.
 * Retorna { average, totalWeight, variance, stdDev } ou null se sem dados.
 */
function weightedAverage(
  items: Array<{ value: number; weight: number }>
): { average: number; totalWeight: number; variance: number; stdDev: number } | null {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0)

  if (totalWeight === 0) return null

  // Média ponderada
  const average = items.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight

  // Variância ponderada
  const variance =
    items.reduce((sum, item) => sum + item.weight * (item.value - average) ** 2, 0) / totalWeight

  return { average, totalWeight, variance, stdDev: Math.sqrt(variance) }
}

/**
 * Calcula o cold start: blending inteligente quando tem poucos registros (0-3).
 * Com 0: usa preset, com 1: 80% real + 20% preset, com 2-3: média + blending progressivo.
 */
function coldStartOffset(
  records: WeightedRecord[],
  presetOffset: number
): { offset: number; isColdStart: boolean } {
  // Filtra registros válidos (não outliers, com peso > 0)
  const validRecords = records.filter(r => !r.isOutlier && r.weight > 0)

  if (validRecords.length === 0) {
    // Sem dados: usa estimativa manual do preset
    return { offset: presetOffset, isColdStart: true }
  }

  if (validRecords.length === 1) {
    // 1 registro: 80% dado real + 20% preset
    return {
      offset: validRecords[0].offset * 0.8 + presetOffset * 0.2,
      isColdStart: true,
    }
  }

  if (validRecords.length <= 3) {
    // 2-3 registros: média simples + blending progressivo com preset
    const avg = validRecords.reduce((sum, r) => sum + r.offset, 0) / validRecords.length
    const blendFactor = validRecords.length / 4 // 0.5 pra 2 registros, 0.75 pra 3
    return {
      offset: avg * blendFactor + presetOffset * (1 - blendFactor),
      isColdStart: true,
    }
  }

  // 4+ registros: não é cold start
  return { offset: 0, isColdStart: false }
}

/**
 * Calcula a tendência de atraso usando regressão linear nos últimos N dias.
 * Retorna a direção da tendência e o offset projetado pro dia atual.
 */
function calculateTrendProjection(
  records: WeightedRecord[]
): {
  direction: 'rising' | 'falling' | 'stable' | 'insufficient'
  strength: number
  projectedOffset: number | null
} {
  // Filtra registros dos últimos N dias (não outliers)
  const recentRecords = records.filter(
    r => !r.isOutlier && r.daysSinceRecord <= PREDICTION_CONFIG.TREND_WINDOW_DAYS
  )

  // Precisa de pelo menos 4 pontos pra regressão significativa
  if (recentRecords.length < 4) {
    return { direction: 'insufficient', strength: 0, projectedOffset: null }
  }

  // Monta pontos pra regressão (x = dias atrás invertido pra que x cresce com o tempo)
  const points = recentRecords.map(r => ({
    x: PREDICTION_CONFIG.TREND_WINDOW_DAYS - r.daysSinceRecord,
    y: r.offset,
  }))

  const regression = linearRegression(points)

  // Se R² muito baixo, tendência não é confiável
  if (regression.rSquared < PREDICTION_CONFIG.TREND_MIN_RSQUARED) {
    return { direction: 'stable', strength: regression.rSquared, projectedOffset: null }
  }

  // Projeta pro dia atual (x = TREND_WINDOW_DAYS = hoje)
  const projectedOffset = regression.slope * PREDICTION_CONFIG.TREND_WINDOW_DAYS + regression.intercept

  // Determina a direção baseada no slope
  let direction: 'rising' | 'falling' | 'stable'
  if (regression.slope > 0.1) {
    direction = 'rising'   // Atrasos aumentando
  } else if (regression.slope < -0.1) {
    direction = 'falling'  // Atrasos diminuindo
  } else {
    direction = 'stable'
  }

  return { direction, strength: regression.rSquared, projectedOffset }
}

/**
 * Previsão principal v2: dado um schedule, preset e registros históricos,
 * calcula quando o ônibus vai chegar no ponto e no destino.
 * Inclui detecção de outliers, sazonalidade, tendência e intervalo de confiança.
 */
export function predictArrival(
  schedule: Schedule,
  preset: Preset,
  records: TripRecord[]
): Prediction {
  // Dia da semana atual (0=domingo, 6=sábado)
  const today = new Date()
  const targetDayOfWeek = today.getDay()
  const targetDayType = schedule.dayType

  // Calcula pesos pra todos os registros
  const weighted = calculateWeightedRecords(
    records,
    schedule.departureTime,
    targetDayOfWeek,
    targetDayType
  )

  // ─── Detecção de Outliers (IQR) ────────────────────────────────

  // Coleta offsets dos registros não-marcados manualmente
  const nonManualOutlierRecords = weighted.filter(r => !r.isOutlier)
  const allOffsets = nonManualOutlierRecords.map(r => r.offset)
  const outlierResult = detectOutliers(allOffsets)

  // Marca outliers detectados pelo algoritmo (peso → 0)
  let outlierCount = weighted.filter(r => r.isOutlier).length // Manuais
  outlierResult.outlierIndices.forEach(idx => {
    // Encontra o registro correspondente e zera seu peso
    const record = nonManualOutlierRecords[idx]
    if (record) {
      record.weight = 0
      record.isOutlier = true
      outlierCount++
    }
  })

  const isOutlierFiltered = outlierCount > 0

  // ─── Cold Start Check ──────────────────────────────────────────

  const coldStart = coldStartOffset(weighted, preset.estimatedBoardingOffset)

  // ─── Previsão do offset de embarque ─────────────────────────────

  let finalOffset: number
  let totalWeight: number
  let variance: number
  let stdDev: number

  if (coldStart.isColdStart) {
    // Cold start: usa heurística especial
    finalOffset = coldStart.offset
    totalWeight = weighted.filter(r => !r.isOutlier && r.weight > 0).length * 0.5
    variance = 0
    stdDev = 0
  } else {
    // Modo normal: média ponderada dos registros válidos (não-outliers)
    const offsetItems = weighted
      .filter(r => !r.isOutlier)
      .map(w => ({ value: w.offset, weight: w.weight }))
    const offsetResult = weightedAverage(offsetItems)

    if (offsetResult) {
      totalWeight = offsetResult.totalWeight
      variance = offsetResult.variance
      stdDev = offsetResult.stdDev

      // Blending com estimativa manual quando tem poucos dados
      if (totalWeight < PREDICTION_CONFIG.BLEND_THRESHOLD) {
        const blendFactor = totalWeight / PREDICTION_CONFIG.BLEND_THRESHOLD
        finalOffset =
          blendFactor * offsetResult.average +
          (1 - blendFactor) * preset.estimatedBoardingOffset
      } else {
        finalOffset = offsetResult.average
      }
    } else {
      // Sem dados válidos (todos eram outliers?)
      finalOffset = preset.estimatedBoardingOffset
      totalWeight = 0
      variance = 0
      stdDev = 0
    }
  }

  // ─── Tendência (Regressão Linear) ──────────────────────────────

  const trend = calculateTrendProjection(weighted)

  // Se tendência significativa, faz blending com a projeção
  if (trend.projectedOffset !== null && !coldStart.isColdStart) {
    finalOffset =
      (1 - PREDICTION_CONFIG.TREND_BLEND_FACTOR) * finalOffset +
      PREDICTION_CONFIG.TREND_BLEND_FACTOR * trend.projectedOffset
  }

  // Horário previsto de chegada do ônibus no ponto
  const predictedBusArrival = addMinutes(schedule.departureTime, Math.round(finalOffset))

  // ─── Intervalo de Confiança ────────────────────────────────────

  const intervalSpread = calculateConfidenceInterval(stdDev, totalWeight)
  const confidenceInterval: ConfidenceInterval = {
    lowerBound: addMinutes(predictedBusArrival, -intervalSpread),
    upperBound: addMinutes(predictedBusArrival, intervalSpread),
    spreadMinutes: intervalSpread * 2,
  }

  // ─── Previsão da duração da viagem ──────────────────────────────

  // Só usa registros válidos que têm dados de chegada no destino
  const tripItems = weighted
    .filter(w => w.tripDuration !== null && !w.isOutlier)
    .map(w => ({ value: w.tripDuration!, weight: w.weight }))

  const tripResult = weightedAverage(tripItems)
  let predictedTripDuration: number | null = null
  let predictedDestinationArrival: string | null = null

  if (tripResult) {
    // Blending com estimativa manual
    const tripTotalWeight = tripResult.totalWeight
    if (tripTotalWeight < PREDICTION_CONFIG.BLEND_THRESHOLD) {
      const blendFactor = tripTotalWeight / PREDICTION_CONFIG.BLEND_THRESHOLD
      predictedTripDuration =
        blendFactor * tripResult.average +
        (1 - blendFactor) * preset.estimatedTripDuration
    } else {
      predictedTripDuration = tripResult.average
    }

    predictedDestinationArrival = addMinutes(
      predictedBusArrival,
      Math.round(predictedTripDuration)
    )
  } else if (preset.estimatedTripDuration > 0) {
    // Sem dados de viagem: usa estimativa manual
    predictedTripDuration = preset.estimatedTripDuration
    predictedDestinationArrival = addMinutes(
      predictedBusArrival,
      Math.round(predictedTripDuration)
    )
  }

  // ─── Cálculo de confiança ───────────────────────────────────────

  // Confiança baseada na quantidade de dados e consistência
  const dataConfidence = Math.min(1, totalWeight / PREDICTION_CONFIG.MIN_WEIGHT_FULL_CONFIDENCE)
  const consistencyBonus = Math.max(0, 1 - stdDev / PREDICTION_CONFIG.CONSISTENCY_MAX_STDDEV)
  let confidence = Math.round((dataConfidence * 0.7 + consistencyBonus * 0.3) * 100)

  // Cap de confiança durante cold start
  if (coldStart.isColdStart) {
    confidence = Math.min(confidence, PREDICTION_CONFIG.COLD_START_MAX_CONFIDENCE)
  }

  // ─── Score de confiabilidade da linha ──────────────────────────

  const validOffsets = weighted.filter(r => !r.isOutlier).map(r => r.offset)
  const lineReliabilityScore = calculateLineReliability(validOffsets)

  // Label de confiabilidade
  const recordCount = records.length
  let reliability: Prediction['reliability']
  if (recordCount === 0) {
    reliability = 'none'
  } else if (confidence < 30) {
    reliability = 'low'
  } else if (confidence < 70) {
    reliability = 'medium'
  } else {
    reliability = 'high'
  }

  return {
    scheduledDeparture: schedule.departureTime,
    predictedBusArrival,
    predictedDestinationArrival,
    boardingOffset: Math.round(finalOffset),
    tripDuration: predictedTripDuration !== null ? Math.round(predictedTripDuration) : null,
    confidence,
    recordCount,
    reliability,
    // Campos v2
    confidenceInterval,
    lineReliabilityScore,
    isOutlierFiltered,
    outlierCount,
    trendDirection: trend.direction,
    trendStrength: trend.strength,
  }
}

/**
 * Encontra o próximo ônibus disponível.
 * Percorre todos os horários do dia atual e retorna a previsão
 * do primeiro ônibus que ainda não passou.
 * Retorna null se não tem mais ônibus hoje.
 */
export function findNextBus(
  preset: Preset,
  schedules: Schedule[],
  records: TripRecord[],
  currentDayType: DayType,
  now?: string
): Prediction | null {
  const currentTimeStr = now ?? currentTime()
  const currentMinutes = timeToMinutes(currentTimeStr)

  // Filtra só os horários do tipo de dia atual e ordena por horário
  const todaySchedules = schedules
    .filter((s) => s.dayType === currentDayType)
    .sort((a, b) => timeToMinutes(a.departureTime) - timeToMinutes(b.departureTime))

  // Percorre cada horário e verifica se o ônibus ainda não passou
  for (const schedule of todaySchedules) {
    const prediction = predictArrival(schedule, preset, records)
    const arrivalMinutes = timeToMinutes(prediction.predictedBusArrival)

    // Se o ônibus ainda não chegou no ponto, esse é o próximo
    if (arrivalMinutes > currentMinutes) {
      return prediction
    }
  }

  // Nenhum ônibus mais hoje
  return null
}

/**
 * Encontra os próximos N ônibus disponíveis.
 * Retorna array de previsões ordenadas por horário.
 */
export function findNextBuses(
  preset: Preset,
  schedules: Schedule[],
  records: TripRecord[],
  currentDayType: DayType,
  count: number = 3,
  now?: string
): Prediction[] {
  const currentTimeStr = now ?? currentTime()
  const currentMinutes = timeToMinutes(currentTimeStr)
  const results: Prediction[] = []

  // Filtra só os horários do tipo de dia atual e ordena por horário
  const todaySchedules = schedules
    .filter((s) => s.dayType === currentDayType)
    .sort((a, b) => timeToMinutes(a.departureTime) - timeToMinutes(b.departureTime))

  // Percorre cada horário e coleta até N ônibus que ainda não passaram
  for (const schedule of todaySchedules) {
    if (results.length >= count) break

    const prediction = predictArrival(schedule, preset, records)
    const arrivalMinutes = timeToMinutes(prediction.predictedBusArrival)

    // Se o ônibus ainda não chegou no ponto, adiciona
    if (arrivalMinutes > currentMinutes) {
      results.push(prediction)
    }
  }

  return results
}

/**
 * Calcula quantos minutos faltam pra o ônibus chegar no ponto.
 * Retorna valor negativo se o ônibus já deveria ter passado.
 */
export function minutesUntilArrival(prediction: Prediction): number {
  return timeDiffMinutes(currentTime(), prediction.predictedBusArrival)
}
