import { createDatabase } from '../client'
import type { Database } from '../types'

/** In-memory SQLite with all migrations applied. Handy for unit tests. */
export async function createTestDatabase(): Promise<Database> {
  const db = await createDatabase({ url: ':memory:', dialect: 'sqlite' })
  await db.migrate()
  return db
}

export type { Database } from '../types'
