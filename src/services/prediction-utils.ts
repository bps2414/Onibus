// ============================================================
// prediction-utils.ts — Funções estatísticas puras para o motor de previsão v2
// Usado pelo prediction.ts como utilitários de cálculo
// ============================================================

import type { TimeBand, TimeBandConfig } from '../types'
import { timeToMinutes } from '../utils/time'

// ============================================================
// Helpers internos
// ============================================================

/**
 * Calcula o percentil de um array já ordenado.
 * Usa interpolação linear entre os dois valores mais próximos.
 *
 * @param sorted - Array de números já em ordem crescente
 * @param p - Percentil desejado (0 a 1, ex: 0.25 pra Q1)
 * @returns Valor no percentil solicitado
 */
function percentile(sorted: number[], p: number): number {
  // Posição contínua no array
  const index = p * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)

  // Se cai exatamente num índice, retorna direto
  if (lower === upper) return sorted[lower]

  // Interpolação linear entre os dois vizinhos
  const weight = index - lower
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

/**
 * Calcula o desvio padrão (populacional) de um array de números.
 *
 * @param values - Array de números
 * @returns Desvio padrão
 */
function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const squaredDiffs = values.map((v) => (v - mean) ** 2)
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length

  return Math.sqrt(variance)
}

// ============================================================
// Funções exportadas
// ============================================================

/**
 * Detecta outliers usando o método IQR (Interquartile Range).
 * Registros com offset fora de Q1 - 1.5*IQR ou Q3 + 1.5*IQR são considerados outliers.
 * Com menos de 5 valores, retorna todos como válidos (dados insuficientes pra filtrar).
 *
 * @param offsets - Array de offsets (atrasos em minutos)
 * @returns Objeto com valores filtrados e índices dos outliers
 */
export function detectOutliers(offsets: number[]): {
  filtered: number[]
  outlierIndices: number[]
  lowerBound: number
  upperBound: number
} {
  // Sem dados suficientes, não dá pra filtrar nada
  if (offsets.length < 5) {
    return {
      filtered: [...offsets],
      outlierIndices: [],
      lowerBound: -Infinity,
      upperBound: Infinity,
    }
  }

  // Ordena uma cópia pra calcular os quartis
  const sorted = [...offsets].sort((a, b) => a - b)

  const q1 = percentile(sorted, 0.25)
  const q3 = percentile(sorted, 0.75)
  const iqr = q3 - q1

  // Se todos os valores são iguais, não tem outlier
  if (iqr === 0) {
    return {
      filtered: [...offsets],
      outlierIndices: [],
      lowerBound: q1,
      upperBound: q3,
    }
  }

  const lowerBound = q1 - 1.5 * iqr
  const upperBound = q3 + 1.5 * iqr

  const filtered: number[] = []
  const outlierIndices: number[] = []

  // Varre o array original (não o ordenado!) pra manter os índices corretos
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] < lowerBound || offsets[i] > upperBound) {
      outlierIndices.push(i)
    } else {
      filtered.push(offsets[i])
    }
  }

  return { filtered, outlierIndices, lowerBound, upperBound }
}

/**
 * Retorna a configuração padrão de faixas horárias.
 * Pode ser usada como base ou sobrescrita por faixas adaptativas.
 */
export function getDefaultTimeBands(): TimeBandConfig[] {
  return [
    { band: 'dawn',         label: 'Madrugada',   startMinute: 0,    endMinute: 360  },
    { band: 'morning_rush', label: 'Manhã Rush',   startMinute: 360,  endMinute: 540  },
    { band: 'midday',       label: 'Entrepico',    startMinute: 540,  endMinute: 960  },
    { band: 'evening_rush', label: 'Tarde Rush',   startMinute: 960,  endMinute: 1140 },
    { band: 'night',        label: 'Noite',        startMinute: 1140, endMinute: 1440 },
  ]
}

/**
 * Classifica um horário HH:MM numa faixa horária.
 * Faixas fixas padrão:
 * - dawn (Madrugada): 00:00-06:00
 * - morning_rush (Manhã Rush): 06:00-09:00
 * - midday (Entrepico): 09:00-16:00
 * - evening_rush (Tarde Rush): 16:00-19:00
 * - night (Noite): 19:00-00:00
 *
 * @param timeStr - Horário no formato HH:MM
 * @param customBands - Faixas customizadas (opcional, pra faixas adaptativas)
 * @returns A faixa horária correspondente
 */
export function getTimeBand(timeStr: string, customBands?: TimeBandConfig[]): TimeBand {
  const minutes = timeToMinutes(timeStr)
  const bands = customBands ?? getDefaultTimeBands()

  // Procura a faixa onde o horário se encaixa (startMinute inclusive, endMinute exclusive)
  for (const config of bands) {
    if (minutes >= config.startMinute && minutes < config.endMinute) {
      return config.band
    }
  }

  // Fallback — se nenhuma faixa bater (não deveria acontecer com as faixas padrão)
  return 'night'
}

/**
 * Calcula o peso baseado na faixa horária.
 * Mesma faixa = 1.5x bônus, faixa diferente = 0.5x penalidade.
 *
 * @param recordTime - Horário do registro HH:MM
 * @param targetTime - Horário alvo HH:MM
 * @param customBands - Faixas customizadas (opcional)
 * @returns Multiplicador de peso (1.5 se mesma faixa, 0.5 se diferente)
 */
export function calcTimeBandWeight(
  recordTime: string,
  targetTime: string,
  customBands?: TimeBandConfig[],
): number {
  const recordBand = getTimeBand(recordTime, customBands)
  const targetBand = getTimeBand(targetTime, customBands)

  return recordBand === targetBand ? 1.5 : 0.5
}

/**
 * Calcula regressão linear simples (mínimos quadrados) pra um conjunto de pontos.
 * Usado pra detectar tendência de atraso crescendo ou diminuindo.
 *
 * @param points - Array de pontos {x, y} onde x=dias e y=offset
 * @returns Objeto com slope (inclinação), intercept, e rSquared (qualidade do ajuste)
 */
export function linearRegression(
  points: Array<{ x: number; y: number }>,
): { slope: number; intercept: number; rSquared: number } {
  const n = points.length

  // Sem pontos suficientes, regressão não faz sentido
  if (n < 2) {
    return { slope: 0, intercept: 0, rSquared: 0 }
  }

  // Somatórios necessários pra mínimos quadrados
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumX2 = 0

  for (const p of points) {
    sumX += p.x
    sumY += p.y
    sumXY += p.x * p.y
    sumX2 += p.x * p.x
  }

  const denominator = n * sumX2 - sumX * sumX

  // Se todos os x são iguais, não dá pra calcular inclinação
  if (denominator === 0) {
    return { slope: 0, intercept: sumY / n, rSquared: 0 }
  }

  const slope = (n * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / n

  // Calcula R² (coeficiente de determinação)
  const meanY = sumY / n
  let ssTot = 0
  let ssRes = 0

  for (const p of points) {
    const predicted = slope * p.x + intercept
    ssRes += (p.y - predicted) ** 2
    ssTot += (p.y - meanY) ** 2
  }

  // Se não há variação nos dados (todos iguais), R² = 0
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot

  return { slope, intercept, rSquared }
}

/**
 * Calcula o intervalo de confiança de 95% pra a previsão.
 * Intervalo = ±1.96 * σ / √(peso_total)
 * Mínimo de ±2min, máximo de ±15min.
 *
 * @param stdDev - Desvio padrão ponderado dos offsets
 * @param totalWeight - Peso total acumulado dos registros
 * @returns Largura do intervalo em minutos (valor positivo, ex: 4 significa ±4min)
 */
export function calculateConfidenceInterval(stdDev: number, totalWeight: number): number {
  // Sem peso, incerteza máxima
  if (totalWeight <= 0) return 15

  // Margem de erro com z=1.96 (95% de confiança)
  const margin = 1.96 * stdDev / Math.sqrt(totalWeight)

  // Limita entre 2 e 15 minutos
  const clamped = Math.min(15, Math.max(2, margin))

  return Math.round(clamped)
}

/**
 * Calcula o score de confiabilidade de uma linha de ônibus (0-100).
 * Baseado no desvio padrão dos offsets:
 * - σ < 3min → score 90+
 * - σ 3-8min → score 50-90 (interpolação linear)
 * - σ > 8min → score < 50 (decaimento)
 *
 * @param offsets - Array de offsets (atrasos em minutos)
 * @returns Score de 0 a 100
 */
export function calculateLineReliability(offsets: number[]): number {
  // Dados insuficientes — score neutro
  if (offsets.length < 3) return 50

  const stdDev = standardDeviation(offsets)

  let score: number

  if (stdDev < 3) {
    // Muito consistente — score alto (90 a 100)
    score = 90 + (3 - stdDev) * 10 / 3
    score = Math.min(100, score)
  } else if (stdDev <= 8) {
    // Variabilidade moderada — interpolação linear de 90 a 50
    score = 90 - (stdDev - 3) * 40 / 5
  } else {
    // Alta variabilidade — decaimento a partir de 50
    score = Math.max(0, 50 - (stdDev - 8) * 5)
  }

  return Math.round(score)
}
