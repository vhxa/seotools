import type { z } from 'zod'
import { decryptString, encryptString } from './crypto'

export interface StoredSetting {
  value: string
  encrypted: boolean
}

/** Persistence port, implemented by `@seotools/db`. */
export interface SettingsStore {
  get(key: string): Promise<StoredSetting | null>
  set(key: string, value: string, encrypted: boolean): Promise<void>
  delete(key: string): Promise<void>
}

/** Typed JSON settings on top of a store, with optional at-rest encryption. */
export function createSettings(store: SettingsStore, secret: string) {
  return {
    async getJson<S extends z.ZodType>(key: string, schema: S): Promise<z.infer<S> | null> {
      const row = await store.get(key)
      if (!row) return null
      const raw = row.encrypted ? decryptString(row.value, secret) : row.value
      return schema.parse(JSON.parse(raw))
    },
    async setJson(key: string, value: unknown, options: { encrypted?: boolean } = {}) {
      const json = JSON.stringify(value)
      const encrypted = options.encrypted ?? false
      await store.set(key, encrypted ? encryptString(json, secret) : json, encrypted)
    },
    delete: (key: string) => store.delete(key),
  }
}

export type Settings = ReturnType<typeof createSettings>
