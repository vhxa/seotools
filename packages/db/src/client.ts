import { withArchiveGuard } from './archive'
import { detectDialect } from './dialect'
import { migrationsDirOf } from './migrations-dir'
import type { Database, Dialect } from './types'

export interface CreateDatabaseOptions {
  url: string
  dialect?: Dialect
}

/** See `migrationsDirOf`: `MIGRATIONS_DIR`, or the folder found from the source or the bundle. */
const migrationsDirFor = (dialect: Dialect) => () => migrationsDirOf(dialect)

/** Connects to the database described by `url`. Drivers are loaded lazily, per dialect. */
export async function createDatabase(options: CreateDatabaseOptions): Promise<Database> {
  const dialect = detectDialect(options.url, options.dialect)
  const config = { url: options.url, defaultMigrationsDir: migrationsDirFor(dialect) }
  switch (dialect) {
    case 'sqlite':
      return withArchiveGuard((await import('./dialects/sqlite')).createSqliteDatabase(config))
    case 'pg':
      return withArchiveGuard((await import('./dialects/pg')).createPgDatabase(config))
    case 'mysql':
      return withArchiveGuard((await import('./dialects/mysql')).createMysqlDatabase(config))
  }
}
