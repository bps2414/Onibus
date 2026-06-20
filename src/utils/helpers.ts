// ============================================================
// helpers.ts — Funções auxiliares gerais
// ============================================================

import type { DayType } from '../types'

// Gera um ID único usando crypto.randomUUID() com fallback pra timestamp + random
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  // Fallback: timestamp em base36 + parte aleatória
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}-${random}`
}

// Detecta o tipo de dia baseado no Date object
export function detectDayType(date: Date): DayType {
  const day = date.getDay()

  // 0 = domingo
  if (day === 0) return 'sunday_holiday'

  // 6 = sábado
  if (day === 6) return 'saturday'

  // 1-5 = dia útil
  return 'weekday'
}

// Retorna o dia da semana (0-6) de uma data YYYY-MM-DD
export function getDayOfWeek(dateStr: string): number {
  // Cria a data com horário zerado pra evitar problemas de timezone
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getDay()
}

// Debounce — atrasa a execução de uma função até que pare de ser chamada por X ms
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): T {
  let timer: ReturnType<typeof setTimeout> | null = null

  const debounced = (...args: unknown[]) => {
    if (timer !== null) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      fn(...args)
      timer = null
    }, ms)
  }

  return debounced as T
}
