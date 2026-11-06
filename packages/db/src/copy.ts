import type BetterSqlite3 from 'better-sqlite3'
import { getTableColumns, getTableName, is, type Column } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'
import type postgres from 'postgres'
import { AUDIT_SEMANTICS_SETTING } from './audit'
import { migrationsDirFor } from './client'
import * as pgSchema from './schema/pg'
import * as sqliteSchema from './schema/sqlite'
import type { Database } from './types'

/** What a table held in each database after a copy. */
export interface TableCopy {
  table: string
  /** Rows in the source. */
  source: number
  /** Rows in the target. */
  target: number
}

export interface CopyOptions {
  /** Called when a table starts and when it is done. */
  onTable?: (event: { table: string; rows?: number; done: boolean }) => void
  /** Rows per insert; lowered when a table has many columns. */
  batchSize?: number
  /** Where the image's migrations are, instead of the default. */
  migrationsDir?: (dialect: 'sqlite' | 'pg') => string
}

/** Raised for what the operator has to fix before trying again, never for a bug. */
export class CopyRefusedError extends Error {
  override name = 'CopyRefusedError'
}

// Postgres accepts 65,534 parameters per statement.
const MAX_PARAMETERS = 30_000
const DEFAULT_BATCH = 500

interface TablePair {
  name: string
  sqlite: SQLiteTable
  pg: PgTable
  /** TypeScript key → source column, in the schema's order. */
  columns: { key: string; sqlite: Column; sqlName: string }[]
}

/** The tables both schemas declare, parents before the tables that reference them. */
export function tablesInCopyOrder(): TablePair[] {
  const sqliteTables = new Map<string, SQLiteTable>()
  for (const value of Object.values(sqliteSchema as Record<string, unknown>)) {
    if (is(value, SQLiteTable)) sqliteTables.set(getTableName(value), value)
  }
  const pgTables = new Map<string, PgTable>()
  for (const value of Object.values(pgSchema as Record<string, unknown>)) {
    if (is(value, PgTable)) pgTables.set(getTableName(value), value)
  }
  const names = [...pgTables.keys()].sort()
  const differing = [...new Set([...sqliteTables.keys(), ...pgTables.keys()])].filter(
    (name) => !sqliteTables.has(name) || !pgTables.has(name),
  )
  if (differing.length > 0) {
    throw new Error(`The SQLite and PostgreSQL schemas differ in tables: ${differing.join(', ')}`)
  }

  const ordered: string[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (name: string) => {
    if (state.get(name) === 'done') return
    if (state.get(name) === 'visiting') {
      throw new Error(`Foreign keys form a cycle through ${name}`)
    }
    state.set(name, 'visiting')
    const table = pgTables.get(name)!
    const parents = getTableConfig(table)
      .foreignKeys.map((fk) => getTableName(fk.reference().foreignTable))
      .filter((parent) => parent !== name)
      .sort()
    for (const parent of parents) visit(parent)
    state.set(name, 'done')
    ordered.push(name)
  }
  for (const name of names) visit(name)

  return ordered.map((name) => {
    const sqlite = sqliteTables.get(name)!
    const pg = pgTables.get(name)!
    const sqliteColumns = getTableColumns(sqlite)
    const pgColumns = getTableColumns(pg)
    const same =
      Object.keys(sqliteColumns).length === Object.keys(pgColumns).length &&
      Object.entries(sqliteColumns).every(
        ([key, column]) => pgColumns[key]?.name === (column as Column).name,
      )
    if (!same) throw new Error(`The SQLite and PostgreSQL schemas differ in columns of ${name}`)
    return {
      name,
      sqlite,
      pg,
      columns: Object.entries(sqliteColumns).map(([key, column]) => ({
        key,
        sqlite: column as Column,
        sqlName: (column as Column).name,
      })),
    }
  })
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

function clients(source: Database, target: Database) {
  if (source.dialect !== 'sqlite' || target.dialect !== 'pg') {
    throw new CopyRefusedError(
      'Only copying from SQLite to PostgreSQL is supported ' +
        `(the source is ${source.dialect}, the target is ${target.dialect}).`,
    )
  }
  const sqlite = (source.orm.db as { $client: BetterSqlite3.Database }).$client
  const pgDb = target.orm.db as PostgresJsDatabase
  const pg = (pgDb as unknown as { $client: postgres.Sql }).$client
  return { sqlite, pgDb, pg }
}

/** The source must have exactly the migrations of this image: no fewer (old schema), no more. */
function assertSourceCurrent(sqlite: BetterSqlite3.Database, dir: string) {
  const exists = sqlite
    .prepare(
      "select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
    )
    .get()
  const applied = exists
    ? (sqlite.prepare('select hash, created_at from __drizzle_migrations').all() as {
        hash: string
        created_at: number | string | null
      }[])
    : []
  const known = readMigrationFiles({ migrationsFolder: dir })
  const unknown = applied.some(
    (row) => !known.some((m) => m.hash === row.hash && m.folderMillis === Number(row.created_at)),
  )
  if (unknown) {
    throw new CopyRefusedError(
      'The source database is newer than this image or has an unknown migration history. ' +
        'Use the image that matches it.',
    )
  }
  const missing = known.filter(
    (m) => !applied.some((row) => row.hash === m.hash && Number(row.created_at) === m.folderMillis),
  )
  if (missing.length > 0) {
    throw new CopyRefusedError(
      `The source database lacks ${missing.length} migration(s) of this image. Start this image ` +
        'on the SQLite database first, so that its schema is current, then stop it and try again.',
    )
  }
}

/** Tables of the target that already hold rows. Tables that do not exist yet are empty. */
async function nonEmptyTargetTables(pg: postgres.Sql, tables: TablePair[]) {
  const found: string[] = []
  for (const { name } of tables) {
    const [regclass] = await pg`select to_regclass(${quote(name)}) as name`
    if (!regclass?.name) continue
    // `migrate()` records the meaning of audit rules in `settings` even on an empty database; the
    // copy brings the source's own, so that row alone does not make the target "not empty".
    const [row] =
      name === 'settings'
        ? await pg`select exists (select 1 from settings where key <> ${AUDIT_SEMANTICS_SETTING}) as present`
        : await pg.unsafe(`select exists (select 1 from ${quote(name)}) as present`)
    if (row?.present) found.push(name)
  }
  return found
}

async function assertTargetEmpty(pg: postgres.Sql, tables: TablePair[]) {
  const found = await nonEmptyTargetTables(pg, tables)
  if (found.length > 0) {
    throw new CopyRefusedError(
      `The target database is not empty (rows in: ${found.join(', ')}). Use a new, empty ` +
        'database, or drop this one and create it again.',
    )
  }
}

/**
 * Copies every table of an installation on SQLite to an empty PostgreSQL database, keeping ids,
 * timestamps and text exactly. Applies this image's migrations to the target first. The source is
 * read in one transaction (a consistent snapshot) and never written; each target table is copied
 * in a transaction of its own. On failure the target may hold some tables: drop it and try again.
 */
export async function copySqliteToPostgres(
  source: Database,
  target: Database,
  options: CopyOptions = {},
): Promise<TableCopy[]> {
  const { sqlite, pgDb, pg } = clients(source, target)
  const dirOf = options.migrationsDir ?? ((dialect) => migrationsDirFor(dialect)())
  const tables = tablesInCopyOrder()

  assertSourceCurrent(sqlite, dirOf('sqlite'))
  await target.checkMigrations(dirOf('pg'))
  await assertTargetEmpty(pg, tables)
  await target.migrate(dirOf('pg'))
  await target.settings.delete(AUDIT_SEMANTICS_SETTING)
  await assertTargetEmpty(pg, tables)

  sqlite.exec('begin')
  try {
    for (const pair of tables) {
      options.onTable?.({ table: pair.name, done: false })
      const batchSize = Math.max(
        1,
        Math.min(
          options.batchSize ?? DEFAULT_BATCH,
          Math.floor(MAX_PARAMETERS / pair.columns.length),
        ),
      )
      const select = sqlite.prepare(`select * from ${quote(pair.name)}`)
      let copied = 0
      await pgDb.transaction(async (tx) => {
        let batch: Record<string, unknown>[] = []
        const flush = async () => {
          if (batch.length === 0) return
          await tx.insert(pair.pg).values(batch as (typeof pair.pg.$inferInsert)[])
          copied += batch.length
          batch = []
        }
        for (const raw of select.iterate() as IterableIterator<Record<string, unknown>>) {
          const row: Record<string, unknown> = {}
          for (const { key, sqlite: column, sqlName } of pair.columns) {
            const value = raw[sqlName]
            row[key] =
              value === null || value === undefined ? null : column.mapFromDriverValue(value)
          }
          batch.push(row)
          if (batch.length >= batchSize) await flush()
        }
        await flush()
      })
      options.onTable?.({ table: pair.name, rows: copied, done: true })
    }
  } finally {
    sqlite.exec('rollback')
  }

  const summary: TableCopy[] = []
  for (const { name } of tables) {
    const inSource = (
      sqlite.prepare(`select count(*) as n from ${quote(name)}`).get() as { n: number }
    ).n
    const [row] = await pg.unsafe(`select count(*)::int as n from ${quote(name)}`)
    summary.push({ table: name, source: inSource, target: Number(row?.n) })
  }
  const different = summary.filter((t) => t.source !== t.target)
  if (different.length > 0) {
    throw new Error(
      `Row counts differ after copying: ${different
        .map((t) => `${t.table} (${t.source} → ${t.target})`)
        .join(', ')}`,
    )
  }
  return summary
}

/** A connection URL without its password, safe to print: `postgres://user:***@host:5432/db`. */
export function redactConnectionUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.password) return url
    parsed.password = '***'
    return parsed.toString()
  } catch {
    return url.replace(/\/\/([^:/@\s]*):[^@\s]*@/g, '//$1:***@')
  }
}

/** Takes the passwords of the given URLs out of any text, such as an error message from a driver. */
export function redactSecrets(text: string, urls: readonly string[]): string {
  let result = text
  for (const url of urls) {
    let password = ''
    try {
      password = decodeURIComponent(new URL(url).password)
    } catch {
      // not a URL: nothing to take out beyond the generic pattern below
    }
    if (password) result = result.replaceAll(password, '***')
  }
  return result.replace(/\/\/([^:/@\s]*):[^@\s]*@/g, '//$1:***@')
}
