/**
 * database.ts — Camada de dados IndexedDB
 *
 * Gerencia toda a persistência do BusTracker usando IndexedDB.
 * Banco: 'bustracker-db', versão 1
 * Stores: busLines, busStops, schedules, presets, tripRecords, settings
 */

import type {
  BusLine,
  BusStop,
  Schedule,
  Preset,
  TripRecord,
  AppSettings,
  DayType,
} from '../types'

/** Nome e versão do banco */
const DB_NAME = 'bustracker-db'
const DB_VERSION = 1

/** Configurações padrão do app */
const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  activePresetId: null,
}

/** Chave fixa usada na store de settings */
const SETTINGS_KEY = 'app-settings'

/** Nomes de todas as stores (exceto settings, que tem keyPath diferente) */
const DATA_STORES = [
  'busLines',
  'busStops',
  'schedules',
  'presets',
  'tripRecords',
] as const

/** Instância cacheada do banco */
let cachedDb: IDBDatabase | null = null

/**
 * Inicializa o banco IndexedDB, criando stores e índices se necessário.
 * Retorna a instância do banco pronta pra uso.
 */
export function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Se já temos uma instância aberta, reutiliza
    if (cachedDb) {
      resolve(cachedDb)
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    // Criação/atualização do schema do banco
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Stores com keyPath 'id'
      if (!db.objectStoreNames.contains('busLines')) {
        db.createObjectStore('busLines', { keyPath: 'id' })
      }

      if (!db.objectStoreNames.contains('busStops')) {
        db.createObjectStore('busStops', { keyPath: 'id' })
      }

      if (!db.objectStoreNames.contains('schedules')) {
        const scheduleStore = db.createObjectStore('schedules', { keyPath: 'id' })
        scheduleStore.createIndex('lineId', 'lineId', { unique: false })
        scheduleStore.createIndex('dayType', 'dayType', { unique: false })
      }

      if (!db.objectStoreNames.contains('presets')) {
        db.createObjectStore('presets', { keyPath: 'id' })
      }

      if (!db.objectStoreNames.contains('tripRecords')) {
        const tripStore = db.createObjectStore('tripRecords', { keyPath: 'id' })
        tripStore.createIndex('presetId', 'presetId', { unique: false })
        tripStore.createIndex('date', 'date', { unique: false })
        tripStore.createIndex('dayType', 'dayType', { unique: false })
        tripStore.createIndex('dayOfWeek', 'dayOfWeek', { unique: false })
      }

      // Store de settings usa keyPath 'key' (não 'id')
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' })
      }
    }

    request.onsuccess = (event) => {
      cachedDb = (event.target as IDBOpenDBRequest).result

      // Se a conexão for fechada inesperadamente, limpa o cache
      cachedDb.onclose = () => {
        cachedDb = null
      }

      resolve(cachedDb)
    }

    request.onerror = () => {
      reject(new Error(`Erro ao abrir o banco IndexedDB: ${request.error?.message}`))
    }
  })
}

/**
 * Retorna a instância cacheada do banco, inicializando se necessário.
 * Uso interno — todas as operações passam por aqui.
 */
async function getDB(): Promise<IDBDatabase> {
  if (!cachedDb) {
    return initDB()
  }
  return cachedDb
}

// ─── CRUD Genérico ──────────────────────────────────────────────────────────

/**
 * Retorna todos os itens de uma store.
 */
export async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const request = store.getAll()

    request.onsuccess = () => resolve(request.result as T[])
    request.onerror = () => reject(new Error(`Erro ao buscar dados de '${storeName}': ${request.error?.message}`))
  })
}

/**
 * Retorna um item pelo ID (ou undefined se não existir).
 */
export async function getById<T>(storeName: string, id: string): Promise<T | undefined> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const request = store.get(id)

    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(new Error(`Erro ao buscar item '${id}' em '${storeName}': ${request.error?.message}`))
  })
}

/**
 * Insere ou atualiza um item na store (upsert).
 */
export async function put<T>(storeName: string, item: T): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const request = store.put(item)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error(`Erro ao salvar item em '${storeName}': ${request.error?.message}`))
  })
}

/**
 * Remove um item pelo ID.
 */
export async function remove(storeName: string, id: string): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const request = store.delete(id)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error(`Erro ao remover item '${id}' de '${storeName}': ${request.error?.message}`))
  })
}

/**
 * Limpa todos os dados de uma store.
 */
export async function clear(storeName: string): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const request = store.clear()

    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error(`Erro ao limpar store '${storeName}': ${request.error?.message}`))
  })
}

// ─── Funções Específicas ────────────────────────────────────────────────────

/**
 * Busca horários de uma linha, opcionalmente filtrando por tipo de dia.
 */
export async function getSchedulesByLine(
  lineId: string,
  dayType?: DayType
): Promise<Schedule[]> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('schedules', 'readonly')
    const store = tx.objectStore('schedules')
    const index = store.index('lineId')
    const request = index.getAll(lineId)

    request.onsuccess = () => {
      let results = request.result as Schedule[]

      // Filtra por tipo de dia se especificado
      if (dayType) {
        results = results.filter((s) => s.dayType === dayType)
      }

      resolve(results)
    }

    request.onerror = () =>
      reject(new Error(`Erro ao buscar horários da linha '${lineId}': ${request.error?.message}`))
  })
}

/**
 * Busca todos os registros de viagem de um preset.
 */
export async function getRecordsByPreset(presetId: string): Promise<TripRecord[]> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tripRecords', 'readonly')
    const store = tx.objectStore('tripRecords')
    const index = store.index('presetId')
    const request = index.getAll(presetId)

    request.onsuccess = () => resolve(request.result as TripRecord[])
    request.onerror = () =>
      reject(new Error(`Erro ao buscar registros do preset '${presetId}': ${request.error?.message}`))
  })
}

/**
 * Busca registros de um preset filtrados por tipo de dia.
 */
export async function getRecordsByPresetAndDay(
  presetId: string,
  dayType: DayType
): Promise<TripRecord[]> {
  const records = await getRecordsByPreset(presetId)
  return records.filter((r) => r.dayType === dayType)
}

/**
 * Retorna as configurações do app (ou cria com defaults se não existir).
 */
export async function getSettings(): Promise<AppSettings> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly')
    const store = tx.objectStore('settings')
    const request = store.get(SETTINGS_KEY)

    request.onsuccess = () => {
      if (request.result) {
        // Retorna só os campos de AppSettings, sem a chave interna 'key'
        const { theme, activePresetId } = request.result
        resolve({ theme, activePresetId })
      } else {
        resolve({ ...DEFAULT_SETTINGS })
      }
    }

    request.onerror = () =>
      reject(new Error(`Erro ao buscar configurações: ${request.error?.message}`))
  })
}

/**
 * Salva configurações do app (merge parcial com valores existentes).
 */
export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const current = await getSettings()
  const merged = { ...current, ...settings, key: SETTINGS_KEY }

  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite')
    const store = tx.objectStore('settings')
    const request = store.put(merged)

    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(new Error(`Erro ao salvar configurações: ${request.error?.message}`))
  })
}

/**
 * Exporta TODOS os dados do banco como um objeto (pra backup).
 * Retorna um objeto com todas as stores como propriedades.
 */
export async function getAllData(): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {}

  for (const storeName of DATA_STORES) {
    result[storeName] = await getAll(storeName)
  }

  // Settings é tratado separadamente (formato diferente)
  const settings = await getSettings()
  result['settings'] = [settings]

  return result
}

/**
 * Importa todos os dados de um objeto de backup, substituindo o conteúdo atual.
 * Limpa cada store antes de importar.
 */
export async function importAllData(data: Record<string, unknown[]>): Promise<void> {
  const db = await getDB()

  // Importa cada store de dados
  for (const storeName of DATA_STORES) {
    const items = data[storeName]
    if (!Array.isArray(items)) continue

    // Limpa a store antes de importar
    await clear(storeName)

    // Insere cada item
    for (const item of items) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite')
        const store = tx.objectStore(storeName)
        const request = store.put(item)

        request.onsuccess = () => resolve()
        request.onerror = () =>
          reject(new Error(`Erro ao importar item em '${storeName}': ${request.error?.message}`))
      })
    }
  }

  // Importa settings se presente
  if (Array.isArray(data['settings']) && data['settings'].length > 0) {
    const settingsData = data['settings'][0] as Partial<AppSettings>
    await saveSettings(settingsData)
  }
}
