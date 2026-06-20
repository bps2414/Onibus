/**
 * statistics.ts — Cálculos de Estatísticas
 *
 * Analisa os registros de viagem pra gerar estatísticas úteis:
 * - Atraso médio geral e por dia da semana
 * - Duração média de viagem
 * - Tendência recente (melhorando/piorando)
 * - Precisão das previsões (backtesting)
 */

import type {
  TripRecord,
  Schedule,
  Preset,
  DayStats,
  OverallStats,
} from '../types'

import {
  timeDiffMinutes,
  daysSince,
  dayName,
} from '../utils/time'

import { predictArrival } from './prediction'

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
 * Calcula a tendência recente comparando os últimos 7 dias com os 7 anteriores.
 * - Se diferença > 2min de atraso: worsening
 * - Se diferença < -2min: improving
 * - Se < 5 registros em algum período: insufficient_data
 * - Senão: stable
 */
export function calculateTrend(
  records: TripRecord[]
): 'improving' | 'worsening' | 'stable' | 'insufficient_data' {
  // Últimos 7 dias
  const recent = records.filter((r) => daysSince(r.date) <= 7)
  // 8 a 14 dias atrás
  const previous = records.filter((r) => {
    const days = daysSince(r.date)
    return days > 7 && days <= 14
  })

  // Precisa de pelo menos 5 registros em cada período
  if (recent.length < 5 || previous.length < 5) {
    return 'insufficient_data'
  }

  const recentAvg = average(recent.map(recordDelay))
  const previousAvg = average(previous.map(recordDelay))
  const diff = recentAvg - previousAvg

  // Positivo = piorou (mais atraso), negativo = melhorou
  if (diff > 2) return 'worsening'
  if (diff < -2) return 'improving'
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
  // Precisa de pelo menos 5 registros pra calcular precisão
  if (records.length < 5) return null

  // Ordena por data pra garantir ordem cronológica
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date))

  let hits = 0
  let totalEvaluated = 0

  // Pra cada registro (exceto os primeiros que não têm histórico)
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
    const predictedMinutes = timeDiffMinutes(
      matchingSchedule.departureTime,
      prediction.predictedBusArrival
    )
    const actualMinutes = timeDiffMinutes(
      current.scheduledDeparture,
      current.busArrivedAt
    )

    const error = Math.abs(predictedMinutes - actualMinutes)

    // Acertou se erro ≤ 3 minutos
    if (error <= 3) hits++
    totalEvaluated++
  }

  if (totalEvaluated === 0) return null

  return Math.round((hits / totalEvaluated) * 100)
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

  // Tendência recente
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
