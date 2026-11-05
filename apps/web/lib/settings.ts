import { createSettings, settingsKeyFrom, type Settings } from '@seotools/core'
import { getDb } from './db'
import { getEnv } from './env'

/** Typed access to the `settings` table, with the same encryption key as the worker. */
export async function getSettings(): Promise<Settings> {
  const db = await getDb()
  return createSettings(db.settings, settingsKeyFrom(getEnv()))
}
