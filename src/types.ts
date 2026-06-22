// ============================================================
// types.ts — Todos os tipos e interfaces do BusTracker
// ============================================================

// Linha de ônibus
export interface BusLine {
  id: string
  name: string       // ex: "Linha 305"
  number: string     // ex: "305"
  color: string      // cor hex pra identificar visualmente
}

// Ponto de ônibus
export interface BusStop {
  id: string
  name: string       // ex: "Ponto da Rua XV"
}

// Tipo de dia (útil, sábado ou domingo/feriado)
export type DayType = 'weekday' | 'saturday' | 'sunday_holiday'

// Horário programado (tabela fixa do ônibus)
export interface Schedule {
  id: string
  lineId: string
  dayType: DayType
  departureTime: string  // HH:MM — horário que sai do terminal/origem
}

// Preset (rota salva pelo usuário)
export interface Preset {
  id: string
  name: string              // ex: "Ir pra escola"
  icon: string              // emoji
  lineId: string
  boardingStopId: string    // ponto onde pego o ônibus
  destinationStopId: string // ponto onde desço
  estimatedBoardingOffset: number   // minutos estimados do terminal até meu ponto
  estimatedTripDuration: number     // minutos estimados do meu ponto até o destino
  walkTimeToStop?: number            // minutos de caminhada de casa até o ponto de ônibus
  bufferTime?: number               // minutos de margem de segurança para chegar antes
  preferredScheduleId?: string      // ID do horário de costume configurado
}

// Registro de viagem (dados de aprendizado)
export interface TripRecord {
  id: string
  presetId: string
  date: string                // YYYY-MM-DD
  dayOfWeek: number           // 0=domingo, 1=segunda, ..., 6=sábado
  dayType: DayType
  scheduledDeparture: string  // HH:MM da tabela
  busArrivedAt: string        // HH:MM real que o ônibus chegou no ponto
  arrivedAtDestination?: string // HH:MM real que cheguei no destino (opcional)
  isOutlier?: boolean         // marcado como outlier pelo algoritmo ou manualmente
}

// Configurações do app
export interface AppSettings {
  theme: 'dark' | 'light'
  activePresetId: string | null
}

// Faixa horária do dia (pico, fora de pico, etc)
export type TimeBand = 'dawn' | 'morning_rush' | 'midday' | 'evening_rush' | 'night'

// Configuração de uma faixa horária com limites em minutos
export interface TimeBandConfig {
  band: TimeBand
  startMinute: number  // minutos desde meia-noite (ex: 360 = 06:00)
  endMinute: number    // minutos desde meia-noite (ex: 540 = 09:00)
  label: string        // ex: "Manhã Rush"
}

// Intervalo de confiança da previsão
export interface ConfidenceInterval {
  lowerBound: string    // HH:MM limite inferior
  upperBound: string    // HH:MM limite superior
  spreadMinutes: number // largura total do intervalo em minutos
}

// Resultado de previsão (v2 — com intervalo de confiança, trend e outliers)
export interface Prediction {
  scheduledDeparture: string      // HH:MM da tabela
  predictedBusArrival: string     // HH:MM previsto no meu ponto
  predictedDestinationArrival: string | null // HH:MM previsto no destino
  boardingOffset: number          // minutos de offset previsto
  tripDuration: number | null     // minutos de viagem previsto
  confidence: number              // 0-100
  recordCount: number             // quantos registros basearam a previsão
  reliability: 'none' | 'low' | 'medium' | 'high'
  // Campos v2
  confidenceInterval: ConfidenceInterval       // intervalo de confiança visual
  lineReliabilityScore: number                 // score de confiabilidade da linha (0-100)
  isOutlierFiltered: boolean                   // se algum outlier foi removido
  outlierCount: number                         // quantos outliers foram filtrados
  trendDirection: 'rising' | 'falling' | 'stable' | 'insufficient' // tendência de atraso
  trendStrength: number                        // R² da regressão (0-1, qualidade do ajuste)
}

// Estatísticas por dia da semana
export interface DayStats {
  dayOfWeek: number
  dayName: string
  avgDelay: number            // minutos de atraso médio
  avgTripDuration: number | null
  recordCount: number
  stdDeviation: number        // desvio padrão do atraso
}

// Estatísticas gerais
export interface OverallStats {
  totalRecords: number
  avgDelay: number
  avgTripDuration: number | null
  mostDelayedDay: string | null
  mostPunctualDay: string | null
  delayByDay: DayStats[]
  recentTrend: 'improving' | 'worsening' | 'stable' | 'insufficient_data'
  predictionAccuracy: number | null // percentual de acerto (margem de 3min)
}

// Resultado de backtesting individual (previsão vs realidade)
export interface BacktestResult {
  date: string                // YYYY-MM-DD da viagem
  scheduledDeparture: string  // HH:MM da tabela
  predictedOffset: number     // offset previsto pelo motor (minutos)
  actualOffset: number        // offset real que aconteceu (minutos)
  error: number               // erro absoluto em minutos
  wasAccurate: boolean        // se acertou dentro da margem de 3min
}
