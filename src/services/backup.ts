/**
 * backup.ts — Exportar/Importar dados do BusTracker
 *
 * Permite ao usuário fazer backup completo dos dados
 * e restaurar a partir de um arquivo JSON.
 */

import * as db from '../db/database'
import { currentDate } from '../utils/time'

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
  // Precisa ser um objeto não-nulo
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false
  }

  const obj = data as Record<string, unknown>

  // Verifica se todas as chaves obrigatórias existem e são arrays
  for (const key of REQUIRED_KEYS) {
    if (!(key in obj) || !Array.isArray(obj[key])) {
      return false
    }
  }

  return true
}

/**
 * Exporta TODOS os dados do IndexedDB como JSON e faz download.
 * O arquivo fica com nome: bustracker-backup-YYYY-MM-DD.json
 */
export async function exportBackup(): Promise<void> {
  // Busca todos os dados do banco
  const allData = await db.getAllData()

  // Converte pra JSON formatado (2 espaços de indentação pra legibilidade)
  const jsonStr = JSON.stringify(allData, null, 2)

  // Cria o Blob e o link de download temporário
  const blob = new Blob([jsonStr], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  // Cria um link invisível, clica nele pra iniciar download, e remove
  const link = document.createElement('a')
  link.href = url
  link.download = `bustracker-backup-${currentDate()}.json`
  document.body.appendChild(link)
  link.click()

  // Limpa os recursos
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
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
    // Lê o conteúdo do arquivo
    const text = await file.text()

    // Tenta parsear o JSON
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      return {
        success: false,
        message: 'Arquivo inválido: não é um JSON válido.',
      }
    }

    // Valida a estrutura do backup
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

    // Importa os dados no banco
    await db.importAllData(backupData)

    // Conta quantos registros foram importados
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
