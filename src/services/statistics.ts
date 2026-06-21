/**
 * statistics.ts — Cálculos de Estatísticas v2
 *
 * Analisa os registros de viagem pra gerar estatísticas úteis:
 * - Atraso médio geral e por dia da semana
 * - Duração média de viagem
 * - Tendência recente (regressão linear, não mais comparação simples)
 * - Precisão das previsões (backtesting com resultados detalhados)
 * - Score de confiabilidade da linha
 */

import type {
  TripRecord,
  Schedule,
  Preset,
  DayStats,
  OverallStats,
  BacktestResult,
} from '../types'

import {
  timeDiffMinutes,
  daysSince,
  dayName,
} from '../utils/time'

import { predictArrival } from './prediction'
import { linearRegression, calculateLineReliability } from './prediction-utils'

// ─── Funções Auxiliares ─────────────────────────────────────────────────────

/**
 * Calcula a média de um array de números.
 * Retorna 0 se o array estiver vazio.
 */
function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/**
 * Calcula o desvio padrão de um array de números.
 * Retorna 0 se o array tiver menos de 2 elementos.
 */
function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0
  const avg = average(values)
  const squaredDiffs = values.map((v) => (v - avg) ** 2)
  return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length)
}

/**
 * Calcula o atraso (offset) de um registro.
 * Quantos minutos após o horário da tabela o ônibus chegou no ponto.
 */
function recordDelay(record: TripRecord): number {
  return timeDiffMinutes(record.scheduledDeparture, record.busArrivedAt)
}

/**
 * Calcula a duração da viagem de um registro.
 * Retorna null se não tem dado de chegada no destino.
 */
function recordTripDuration(record: TripRecord): number | null {
  if (!record.arrivedAtDestination) return null
  return timeDiffMinutes(record.busArrivedAt, record.arrivedAtDestination)
}

// ─── Funções Públicas ───────────────────────────────────────────────────────

/**
 * Filtra registros dos últimos N dias.
 */
export function filterRecordsByPeriod(records: TripRecord[], days: number): TripRecord[] {
  return records.filter((r) => daysSince(r.date) <= days)
}

/**
 * Calcula estatísticas por dia da semana (0=domingo a 6=sábado).
 * Retorna um array com 7 itens, um pra cada dia.
 */
export function calculateDayStats(records: TripRecord[]): DayStats[] {
  // Agrupa registros por dia da semana
  const byDay = new Map<number, TripRecord[]>()
  for (let i = 0; i < 7; i++) {
    byDay.set(i, [])
  }

  for (const record of records) {
    const group = byDay.get(record.dayOfWeek)
    if (group) group.push(record)
  }

  // Calcula stats pra cada dia
  return Array.from(byDay.entries()).map(([dow, dayRecords]) => {
    const delays = dayRecords.map(recordDelay)
    const durations = dayRecords
      .map(recordTripDuration)
      .filter((d): d is number => d !== null)

    return {
      dayOfWeek: dow,
      dayName: dayName(dow),
      avgDelay: delays.length > 0 ? Math.round(average(delays) * 10) / 10 : 0,
      avgTripDuration: durations.length > 0 ? Math.round(average(durations) * 10) / 10 : null,
      recordCount: dayRecords.length,
      stdDeviation: delays.length > 0 ? Math.round(standardDeviation(delays) * 10) / 10 : 0,
    }
  })
}

/**
 * Calcula a tendência recente usando regressão linear nos últimos 14 dias.
 * Mais preciso que a comparação simples de 2 semanas da v1.
 * Usa o slope da regressão pra determinar direção.
 */
export function calculateTrend(
  records: TripRecord[]
): 'improving' | 'worsening' | 'stable' | 'insufficient_data' {
  // Filtra registros dos últimos 14 dias
  const recent = records.filter((r) => daysSince(r.date) <= 14)

  // Precisa de pelo menos 5 registros pra tendência confiável
  if (recent.length < 5) {
    return 'insufficient_data'
  }

  // Monta pontos pra regressão (x = dias desde o registro, invertido)
  const points = recent.map(r => ({
    x: 14 - daysSince(r.date), // x crescente com o tempo
    y: recordDelay(r),
  }))

  const regression = linearRegression(points)

  // Se R² muito baixo, dados muito ruidosos
  if (regression.rSquared < 0.15) {
    return 'stable'
  }

  // Slope positivo = atrasos aumentando = piorando
  if (regression.slope > 0.2) return 'worsening'
  if (regression.slope < -0.2) return 'improving'
  return 'stable'
}

/**
 * Calcula a precisão das previsões usando backtesting temporal.
 * Pra cada registro, simula a previsão usando apenas registros ANTERIORES
 * e verifica se acertou com margem de ±3 minutos.
 *
 * Retorna a porcentagem de acerto (0-100), ou null se poucos dados.
 */
export function calculatePredictionAccuracy(
  records: TripRecord[],
  preset: Preset,
  schedules: Schedule[]
): number | null {
  const results = calculateBacktestResults(records, preset, schedules)
  if (results.length === 0) return null
  const hits = results.filter(r => r.wasAccurate).length
  return Math.round((hits / results.length) * 100)
}

/**
 * Calcula resultados detalhados de backtesting pra visualização na aba IA.
 * Retorna array de { date, predicted, actual, error, wasAccurate } pra cada viagem.
 */
export function calculateBacktestResults(
  records: TripRecord[],
  preset: Preset,
  schedules: Schedule[]
): BacktestResult[] {
  // Precisa de pelo menos 5 registros pra backtesting
  if (records.length < 5) return []

  // Ordena por data pra garantir ordem cronológica
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date))
  const results: BacktestResult[] = []

  // Pra cada registro (exceto os primeiros que não têm histórico suficiente)
  for (let i = 2; i < sorted.length; i++) {
    const current = sorted[i]

    // Registros anteriores a este (dados que estariam disponíveis na época)
    const previousRecords = sorted.slice(0, i)

    // Encontra o schedule correspondente a este registro
    const matchingSchedule = schedules.find(
      (s) => s.departureTime === current.scheduledDeparture && s.dayType === current.dayType
    )

    // Se não encontra o schedule, pula
    if (!matchingSchedule) continue

    // Simula a previsão usando apenas dados anteriores
    const prediction = predictArrival(matchingSchedule, preset, previousRecords)

    // Compara previsão com realidade
    const predictedOffset = timeDiffMinutes(
      matchingSchedule.departureTime,
      prediction.predictedBusArrival
    )
    const actualOffset = timeDiffMinutes(
      current.scheduledDeparture,
      current.busArrivedAt
    )

    const error = Math.abs(predictedOffset - actualOffset)

    results.push({
      date: current.date,
      scheduledDeparture: current.scheduledDeparture,
      predictedOffset,
      actualOffset,
      error,
      wasAccurate: error <= 3,
    })
  }

  return results
}

/**
 * Calcula o score de confiabilidade de uma linha baseado nos registros.
 * Wrapper que extrai os offsets e chama calculateLineReliability do prediction-utils.
 */
export function getLineReliabilityScore(records: TripRecord[]): number {
  const offsets = records
    .filter(r => !r.isOutlier)
    .map(recordDelay)
  return calculateLineReliability(offsets)
}

/**
 * Calcula estatísticas gerais de todos os registros.
 * Inclui atraso médio, duração de viagem, dia mais/menos pontual,
 * tendência recente e precisão das previsões.
 */
export function calculateOverallStats(
  records: TripRecord[],
  schedules: Schedule[]
): OverallStats {
  // Sem registros: retorna stats vazias
  if (records.length === 0) {
    return {
      totalRecords: 0,
      avgDelay: 0,
      avgTripDuration: null,
      mostDelayedDay: null,
      mostPunctualDay: null,
      delayByDay: calculateDayStats([]),
      recentTrend: 'insufficient_data',
      predictionAccuracy: null,
    }
  }

  // Atraso médio geral
  const delays = records.map(recordDelay)
  const avgDelay = Math.round(average(delays) * 10) / 10

  // Duração média de viagem (só registros com dado de destino)
  const durations = records
    .map(recordTripDuration)
    .filter((d): d is number => d !== null)
  const avgTripDuration = durations.length > 0
    ? Math.round(average(durations) * 10) / 10
    : null

  // Stats por dia da semana
  const delayByDay = calculateDayStats(records)

  // Dia mais atrasado e mais pontual (só dias com dados)
  const daysWithData = delayByDay.filter((d) => d.recordCount > 0)
  let mostDelayedDay: string | null = null
  let mostPunctualDay: string | null = null

  if (daysWithData.length > 0) {
    const sorted = [...daysWithData].sort((a, b) => a.avgDelay - b.avgDelay)
    mostPunctualDay = sorted[0].dayName
    mostDelayedDay = sorted[sorted.length - 1].dayName
  }

  // Tendência recente (agora usa regressão linear)
  const recentTrend = calculateTrend(records)

  return {
    totalRecords: records.length,
    avgDelay,
    avgTripDuration,
    mostDelayedDay,
    mostPunctualDay,
    delayByDay,
    recentTrend,
    predictionAccuracy: null, // Calculado separadamente (precisa do preset e schedules)
  }
}
