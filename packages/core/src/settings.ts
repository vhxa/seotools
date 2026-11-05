import type { z } from 'zod'
import { decryptString, encryptString, UndecryptableError } from './crypto'

/** What a read of a setting found: nothing saved, a value, or one the current key cannot read. */
export type SettingRead<T> =
  | { state: 'missing' }
  | { state: 'ready'; value: T }
  | { state: 'undecryptable' }

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
  async function getJson<S extends z.ZodType>(
    key: string,
    schema: S,
  ): Promise<z.infer<S> | null> {
    const row = await store.get(key)
    if (!row) return null
    const raw = row.encrypted ? decryptString(row.value, secret) : row.value
    return schema.parse(JSON.parse(raw))
  }
  return {
    getJson,
    /** Like `getJson`, but a value that cannot be decrypted is a state, not an exception. */
    async readJson<S extends z.ZodType>(
      key: string,
      schema: S,
    ): Promise<SettingRead<z.infer<S>>> {
      try {
        const value = await getJson(key, schema)
        return value === null ? { state: 'missing' } : { state: 'ready', value }
      } catch (error) {
        if (error instanceof UndecryptableError) return { state: 'undecryptable' }
        throw error
      }
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
