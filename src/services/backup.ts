/**
 * backup.ts — Exportar/Importar dados do BusTracker v2
 *
 * Permite ao usuário fazer backup dos dados, gerar relatórios legíveis,
 * filtrar por período e compartilhar via Web Share API ou download.
 */

import * as db from '../db/database'
import { currentDate, daysSince } from '../utils/time'

/** Chaves obrigatórias que um backup válido precisa ter */
const REQUIRED_KEYS = [
  'busLines',
  'busStops',
  'schedules',
  'presets',
  'tripRecords',
] as const

/**
 * Valida se o objeto tem a estrutura esperada de um backup.
 * Verifica se todas as chaves obrigatórias existem e são arrays.
 */
function validateBackupData(data: unknown): boolean {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false
  }

  const obj = data as Record<string, unknown>

  for (const key of REQUIRED_KEYS) {
    if (!(key in obj) || !Array.isArray(obj[key])) {
      return false
    }
  }

  return true
}

/**
 * Exporta dados do IndexedDB.
 * 
 * @param period - 'all' | '30' | '7' para filtrar registros
 * @param format - 'json' | 'report' para definir o formato do arquivo
 */
export async function exportBackup(period = 'all', format = 'json'): Promise<void> {
  // Busca todos os dados do banco
  const allData = await db.getAllData()

  // Se solicitado um período específico, filtra as viagens
  if (period !== 'all') {
    const days = Number(period)
    if (allData.tripRecords) {
      allData.tripRecords = allData.tripRecords.filter(r => {
        const dateStr = (r as any).date
        return daysSince(dateStr) <= days
      })
    }
  }

  let blob: Blob
  let filename: string
  let shareTitle: string
  let shareText: string

  if (format === 'json') {
    filename = `bustracker-backup-${currentDate()}.json`
    const jsonStr = JSON.stringify(allData, null, 2)
    blob = new Blob([jsonStr], { type: 'application/json' })
    shareTitle = 'Backup do BusTracker'
    shareText = 'Aqui estão as minhas configurações e histórico de viagens do BusTracker!'
  } else {
    filename = `bustracker-relatorio-${currentDate()}.txt`
    const reportText = generateReadableReport(allData, period)
    blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' })
    shareTitle = 'Relatório de Trânsito BusTracker'
    shareText = 'Aqui está o meu relatório com estatísticas de trânsito do ônibus!'
  }

  const file = new File([blob], filename, { type: blob.type })

  // Tenta compartilhar com a Web Share API se disponível no dispositivo
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: shareTitle,
        text: shareText,
      })
      return // Compartilhado com sucesso
    } catch (err) {
      console.warn('Erro ou cancelamento do compartilhamento Web Share:', err)
      // Se deu erro ou cancelamento, faz o fallback pro download tradicional
    }
  }

  // Fallback: Download via link temporário
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()

  // Limpa recursos
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Gera um relatório legível formatado em texto.
 */
function generateReadableReport(
  allData: Record<string, any[]>,
  period: string
): string {
  const records = allData.tripRecords || []
  const presets = allData.presets || []
  const lines = allData.busLines || []
  const stops = allData.busStops || []

  const periodText = period === 'all' ? 'Todo o Histórico' : `Últimos ${period} Dias`
  
  let text = `==================================================\n`
  text += `      BUSTRACKER — RELATÓRIO DE DESEMPENHO\n`
  text += `      Gerado em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}\n`
  text += `      Filtro de Período: ${periodText}\n`
  text += `==================================================\n\n`

  text += `>> RESUMO GERAL:\n`
  text += `- Total de trajetos configurados: ${presets.length}\n`
  text += `- Total de linhas: ${lines.length}\n`
  text += `- Total de pontos: ${stops.length}\n`
  text += `- Total de viagens gravadas no período: ${records.length}\n`

  if (records.length > 0) {
    const delays = records.map(r => {
      const scheduled = r.scheduledDeparture
      const arrived = r.busArrivedAt
      // timeDiffMinutes calcula b - a
      const [sh, sm] = scheduled.split(':').map(Number)
      const [ah, am] = arrived.split(':').map(Number)
      let diff = (ah * 60 + am) - (sh * 60 + sm)
      if (diff < -720) diff += 1440
      return diff
    })
    const avgDelay = delays.reduce((sum, d) => sum + d, 0) / delays.length
    text += `- Atraso médio geral: ${avgDelay.toFixed(1)} minutos\n`
  }
  text += `\n`

  text += `==================================================\n`
  text += `>> DESEMPENHO DETALHADO POR TRAJETO:\n`
  text += `==================================================\n\n`

  for (const preset of presets) {
    const line = lines.find(l => l.id === preset.lineId)
    const boarding = stops.find(s => s.id === preset.boardingStopId)
    const destination = stops.find(s => s.id === preset.destinationStopId)
    const presetRecords = records.filter(r => r.presetId === preset.id)

    text += `Trajeto: ${preset.name}\n`
    text += `--------------------------------------------------\n`
    text += `Linha: ${line ? `${line.number} - ${line.name}` : 'N/A'}\n`
    text += `Embarque: ${boarding ? boarding.name : 'N/A'}\n`
    text += `Desembarque: ${destination ? destination.name : 'N/A'}\n`
    text += `Viagens registradas no período: ${presetRecords.length}\n`

    if (presetRecords.length > 0) {
      const delays = presetRecords.map(r => {
        const [sh, sm] = r.scheduledDeparture.split(':').map(Number)
        const [ah, am] = r.busArrivedAt.split(':').map(Number)
        let diff = (ah * 60 + am) - (sh * 60 + sm)
        if (diff < -720) diff += 1440
        return diff
      })
      const avgDelay = delays.reduce((sum, d) => sum + d, 0) / delays.length
      text += `Atraso médio no ponto: ${avgDelay.toFixed(1)} minutos\n`

      // Listagem detalhada das viagens recentes
      text += `\nHistórico das viagens (mais recentes primeiro):\n`
      const sorted = [...presetRecords]
        .sort((a, b) => b.date.localeCompare(a.date) || b.scheduledDeparture.localeCompare(a.scheduledDeparture))
        .slice(0, 20)
      
      sorted.forEach(r => {
        const [sh, sm] = r.scheduledDeparture.split(':').map(Number)
        const [ah, am] = r.busArrivedAt.split(':').map(Number)
        let diff = (ah * 60 + am) - (sh * 60 + sm)
        if (diff < -720) diff += 1440
        
        const dateParts = r.date.split('-')
        const dateFmt = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : r.date
        
        text += `- ${dateFmt} às ${r.scheduledDeparture}: chegada real ${r.busArrivedAt} (${diff > 0 ? '+' : ''}${diff} min)${r.isOutlier ? ' [OUTLIER EXCLUÍDO]' : ''}\n`
      })
    } else {
      text += `Nenhuma viagem registrada para este trajeto no período.\n`
    }
    text += `\n--------------------------------------------------\n\n`
  }

  text += `Fim do Relatório. BusTracker - Base de Dados Local.\n`
  return text
}

/**
 * Importa dados de um arquivo JSON de backup.
 * Valida a estrutura antes de importar.
 * Retorna um objeto com status e mensagem descritiva.
 */
export async function importBackup(
  file: File
): Promise<{ success: boolean; message: string }> {
  try {
    const text = await file.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      return {
        success: false,
        message: 'Arquivo inválido: não é um JSON válido.',
      }
    }

    if (!validateBackupData(data)) {
      return {
        success: false,
        message:
          'Estrutura do backup inválida. O arquivo precisa conter: ' +
          REQUIRED_KEYS.join(', ') +
          '.',
      }
    }

    const backupData = data as Record<string, unknown[]>

    await db.importAllData(backupData)

    const totalRecords = REQUIRED_KEYS.reduce((sum, key) => {
      return sum + (backupData[key]?.length ?? 0)
    }, 0)

    return {
      success: true,
      message: `Backup restaurado com sucesso! ${totalRecords} registros importados.`,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido'
    return {
      success: false,
      message: `Erro ao importar backup: ${errorMessage}`,
    }
  }
}
