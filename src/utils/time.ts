// ============================================================
// time.ts — Utilitários de tempo (funções puras)
// ============================================================

// Converte string HH:MM pra minutos desde meia-noite
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

// Converte minutos desde meia-noite pra string HH:MM
export function minutesToTime(minutes: number): string {
  // Normaliza pra ficar dentro de 0-1439 (24h)
  const normalized = ((minutes % 1440) + 1440) % 1440
  const h = Math.floor(normalized / 60)
  const m = normalized % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Diferença em minutos entre dois horários (b - a), lidando com virada de meia-noite
export function timeDiffMinutes(a: string, b: string): number {
  const aMin = timeToMinutes(a)
  const bMin = timeToMinutes(b)
  let diff = bMin - aMin

  // Se a diferença for muito negativa, provavelmente cruzou meia-noite
  if (diff < -720) {
    diff += 1440
  }
  // Se a diferença for muito positiva, provavelmente cruzou meia-noite no sentido inverso (ex: adiantado antes da meia-noite)
  if (diff > 720) {
    diff -= 1440
  }

  return diff
}

// Adiciona minutos a um horário HH:MM
export function addMinutes(time: string, minutes: number): string {
  const total = timeToMinutes(time) + minutes
  return minutesToTime(total)
}

// Retorna o horário atual como HH:MM
export function currentTime(): string {
  const now = new Date()
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

// Retorna a data atual como YYYY-MM-DD
export function currentDate(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Calcula quantos dias se passaram desde uma data YYYY-MM-DD até hoje
export function daysSince(dateStr: string): number {
  const past = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const diffMs = today.getTime() - past.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

// Formata minutos pra display legível: "12min", "1h 30min", "-5min" (negativo = adiantado)
export function formatMinutes(minutes: number): string {
  if (minutes === 0) return '0min'

  const sign = minutes < 0 ? '-' : ''
  const abs = Math.abs(minutes)

  if (abs < 60) {
    return `${sign}${abs}min`
  }

  const h = Math.floor(abs / 60)
  const m = abs % 60

  if (m === 0) {
    return `${sign}${h}h`
  }

  return `${sign}${h}h ${m}min`
}

// Retorna o nome do dia da semana em PT-BR (0=Domingo, 1=Segunda, etc)
export function dayName(dayOfWeek: number): string {
  const names = [
    'Domingo',
    'Segunda',
    'Terça',
    'Quarta',
    'Quinta',
    'Sexta',
    'Sábado',
  ]
  return names[dayOfWeek] ?? 'Desconhecido'
}

// Formata data YYYY-MM-DD pra DD/MM/YYYY
export function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}
