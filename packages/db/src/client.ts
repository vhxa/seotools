import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withArchiveGuard } from './archive'
import { detectDialect } from './dialect'
import type { Database, Dialect } from './types'

export interface CreateDatabaseOptions {
  url: string
  dialect?: Dialect
}

/**
 * `MIGRATIONS_DIR` overrides the location (the Docker image sets it). The default is
 * `packages/db/migrations`, relative to both `src/` and the bundled `dist/`. Built with `path`
 * instead of `new URL(…, import.meta.url)` so bundlers don't try to treat it as an asset.
 */
function migrationsDirFor(dialect: Dialect) {
  return () => {
    const root =
      process.env.MIGRATIONS_DIR ??
      resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
    return `${root}/${dialect}`
  }
}

/** Connects to the database described by `url`. Drivers are loaded lazily, per dialect. */
export async function createDatabase(options: CreateDatabaseOptions): Promise<Database> {
  const dialect = detectDialect(options.url, options.dialect)
  const config = { url: options.url, defaultMigrationsDir: migrationsDirFor(dialect) }
  switch (dialect) {
    case 'sqlite':
      return withArchiveGuard((await import('./dialects/sqlite')).createSqliteDatabase(config))
    case 'pg':
      return withArchiveGuard((await import('./dialects/pg')).createPgDatabase(config))
  }
}
