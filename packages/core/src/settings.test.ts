import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createSettings, type SettingsStore, type StoredSetting } from './settings'

function memoryStore() {
  const rows = new Map<string, StoredSetting>()
  const store: SettingsStore = {
    get: async (k) => rows.get(k) ?? null,
    set: async (k, value, encrypted) => void rows.set(k, { value, encrypted }),
    delete: async (k) => void rows.delete(k),
  }
  return { rows, store }
}

describe('settings', () => {
  const schema = z.object({ token: z.string() })

  it('stores plain JSON when not encrypted', async () => {
    const { rows, store } = memoryStore()
    const settings = createSettings(store, 'k'.repeat(32))
    await settings.setJson('a', { token: 't' })
    expect(rows.get('a')).toEqual({ value: '{"token":"t"}', encrypted: false })
    expect(await settings.getJson('a', schema)).toEqual({ token: 't' })
  })

  it('encrypts at rest and decrypts on read', async () => {
    const { rows, store } = memoryStore()
    const settings = createSettings(store, 'k'.repeat(32))
    await settings.setJson('a', { token: 'super-secret' }, { encrypted: true })
    expect(rows.get('a')).toMatchObject({ encrypted: true })
    expect(rows.get('a')!.value).not.toContain('super-secret')
    expect(await settings.getJson('a', schema)).toEqual({ token: 'super-secret' })
  })

  it('returns null for missing keys and validates what it reads', async () => {
    const { rows, store } = memoryStore()
    const settings = createSettings(store, 'k'.repeat(32))
    expect(await settings.getJson('missing', schema)).toBeNull()
    rows.set('bad', { value: '{"nope":1}', encrypted: false })
    await expect(settings.getJson('bad', schema)).rejects.toThrow()
  })
})
