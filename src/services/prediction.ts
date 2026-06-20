/**
 * prediction.ts — Motor de Previsão Inteligente
 *
 * O coração do BusTracker. Prevê quando o ônibus vai chegar no ponto
 * do usuário usando um algoritmo multi-fatorial que aprende com o histórico.
 *
 * Fatores considerados:
 * - Recência: dados recentes pesam mais (decaimento exponencial)
 * - Dia da semana: mesmo dia pesa muito mais que dias diferentes
 * - Horário: horários similares pesam mais (kernel Gaussiano)
 *
 * Quando tem poucos dados, faz blending com a estimativa manual do preset.
 */

import type {
  Schedule,
  Preset,
  TripRecord,
  Prediction,
  DayType,
} from '../types'

import {
  timeToMinutes,
  timeDiffMinutes,
  addMinutes,
  currentTime,
  daysSince,
} from '../utils/time'

/** Constantes do motor de previsão (exportadas pra permitir tuning) */
export const PREDICTION_CONFIG = {
  RECENCY_DECAY: 0.05,            // Taxa de decaimento diário
  DAY_MATCH_WEIGHT: 1.0,          // Mesmo dia da semana
  DAY_ADJACENT_WEIGHT: 0.5,       // Dia adjacente (±1)
  DAY_SAME_TYPE_WEIGHT: 0.3,      // Mesmo tipo de dia (weekday/weekend) mas dia diferente
  DAY_DIFFERENT_TYPE_WEIGHT: 0.1,  // Tipo de dia diferente
  TIME_SIGMA: 60,                 // Desvio padrão em minutos pro kernel Gaussiano
  BLEND_THRESHOLD: 5.0,           // Peso total mínimo pra confiar só nos dados
  MIN_WEIGHT_FULL_CONFIDENCE: 10, // Peso total pra 100% data confidence
  CONSISTENCY_MAX_STDDEV: 15,     // Desvio padrão máximo (min) pro bônus de consistência
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

// ─── Motor de Previsão ──────────────────────────────────────────────────────

/**
 * Interface interna pra armazenar dados de cada registro com seu peso calculado.
 */
interface WeightedRecord {
  offset: number            // Offset real: quantos min depois da tabela o ônibus chegou
  tripDuration: number | null // Duração da viagem (null se não completou)
  weight: number            // Peso combinado deste registro
}

/**
 * Calcula os pesos pra todos os registros relevantes.
 * Cada registro recebe um peso baseado em recência × dia × horário.
 */
function calculateWeightedRecords(
  records: TripRecord[],
  targetTime: string,
  targetDayOfWeek: number,
  targetDayType: DayType
): WeightedRecord[] {
  return records.map((record) => {
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

    // Peso combinado: multiplicação dos 3 fatores
    const weight = recencyWeight * dayWeight * timeWeight

    return { offset, tripDuration, weight }
  })
}

/**
 * Calcula média ponderada de um conjunto de valores com pesos.
 * Retorna { average, totalWeight, variance } ou null se sem dados.
 */
function weightedAverage(
  items: Array<{ value: number; weight: number }>
): { average: number; totalWeight: number; variance: number } | null {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0)

  if (totalWeight === 0) return null

  // Média ponderada
  const average = items.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight

  // Variância ponderada
  const variance =
    items.reduce((sum, item) => sum + item.weight * (item.value - average) ** 2, 0) / totalWeight

  return { average, totalWeight, variance }
}

/**
 * Previsão principal: dado um schedule, preset e registros históricos,
 * calcula quando o ônibus vai chegar no ponto e no destino.
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

  // ─── Previsão do offset de embarque ─────────────────────────────

  const offsetItems = weighted.map((w) => ({ value: w.offset, weight: w.weight }))
  const offsetResult = weightedAverage(offsetItems)

  let finalOffset: number
  let totalWeight: number
  let variance: number

  if (offsetResult) {
    totalWeight = offsetResult.totalWeight
    variance = offsetResult.variance

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
    // Sem dados: usa estimativa manual
    finalOffset = preset.estimatedBoardingOffset
    totalWeight = 0
    variance = 0
  }

  // Horário previsto de chegada do ônibus no ponto
  const predictedBusArrival = addMinutes(schedule.departureTime, Math.round(finalOffset))

  // ─── Previsão da duração da viagem ──────────────────────────────

  // Só usa registros que têm dados de chegada no destino
  const tripItems = weighted
    .filter((w) => w.tripDuration !== null)
    .map((w) => ({ value: w.tripDuration!, weight: w.weight }))

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

  const stdDev = Math.sqrt(variance)

  // Confiança baseada na quantidade de dados e consistência
  const dataConfidence = Math.min(1, totalWeight / PREDICTION_CONFIG.MIN_WEIGHT_FULL_CONFIDENCE)
  const consistencyBonus = Math.max(0, 1 - stdDev / PREDICTION_CONFIG.CONSISTENCY_MAX_STDDEV)
  const confidence = Math.round((dataConfidence * 0.7 + consistencyBonus * 0.3) * 100)

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
 * Calcula quantos minutos faltam pra o ônibus chegar no ponto.
 * Retorna valor negativo se o ônibus já deveria ter passado.
 */
export function minutesUntilArrival(prediction: Prediction): number {
  return timeDiffMinutes(currentTime(), prediction.predictedBusArrival)
}
