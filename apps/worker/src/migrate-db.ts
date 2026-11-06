import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  CopyRefusedError,
  copySqliteToPostgres,
  createDatabase,
  detectDialect,
  redactConnectionUrl,
  redactSecrets,
  sqlitePathFromUrl,
} from '@seotools/db'

/**
 * Copies an installation's data from SQLite to an empty PostgreSQL database, once, from the command
 * line of the installation (see "Move from SQLite to PostgreSQL" in docs/updating.md):
 *
 *   node worker/dist/migrate-db.mjs --from file:/data/seotools.db --to postgres://user:pass@host:5432/db
 *
 * The SQLite file is only read. Stop the app first. Passwords are never printed.
 */
const usage =
  'Usage: migrate-db.mjs --from file:/data/seotools.db --to postgres://user:password@host:5432/database'

const { values } = (() => {
  try {
    return parseArgs({
      options: { from: { type: 'string' }, to: { type: 'string' }, help: { type: 'boolean' } },
      strict: true,
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    console.error(usage)
    process.exit(2)
  }
})()

if (values.help || !values.from || !values.to) {
  console.error(usage)
  process.exit(values.help ? 0 : 2)
}

const { from, to } = values
const secrets = [from, to]
const say = (message: string) => console.log(redactSecrets(message, secrets))

/** What went wrong in words: drivers sometimes throw errors with no message, or several at once. */
function describe(error: unknown): string {
  if (error instanceof AggregateError) {
    return [...new Set(error.errors.map(describe))].join('; ') || describe(error.cause)
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    const text = error.message || (typeof code === 'string' ? code : error.name)
    return typeof code === 'string' && !text.includes(code) ? `${text} (${code})` : text
  }
  return String(error)
}

try {
  try {
    if (detectDialect(from) !== 'sqlite') {
      throw new CopyRefusedError('--from must be a SQLite database (file:…).')
    }
    if (detectDialect(to) !== 'pg') {
      throw new CopyRefusedError('--to must be a PostgreSQL database (postgres://…).')
    }
  } catch (error) {
    if (error instanceof CopyRefusedError) throw error
    throw new CopyRefusedError(error instanceof Error ? error.message : String(error))
  }
  const sourcePath = sqlitePathFromUrl(from)
  if (sourcePath === ':memory:' || !existsSync(sourcePath)) {
    throw new CopyRefusedError(`There is no SQLite database at ${sourcePath}.`)
  }

  say(`From ${redactConnectionUrl(from)}`)
  say(`To   ${redactConnectionUrl(to)}`)
  const source = await createDatabase({ url: from, dialect: 'sqlite' })
  const target = await createDatabase({ url: to, dialect: 'pg' })
  try {
    const summary = await copySqliteToPostgres(source, target, {
      onTable: ({ table, rows, done }) => {
        if (done) say(`  ${table}: ${rows} row(s)`)
      },
    })
    const width = Math.max(...summary.map((t) => t.table.length))
    say(`\n${'Table'.padEnd(width)}  SQLite  PostgreSQL`)
    for (const t of summary) {
      say(
        `${t.table.padEnd(width)}  ${String(t.source).padStart(6)}  ${String(t.target).padStart(10)}`,
      )
    }
    say(
      `\nCopied ${summary.reduce((n, t) => n + t.source, 0)} row(s) in ${summary.length} tables. ` +
        'Set DATABASE_URL to the PostgreSQL URL and start the app.',
    )
  } finally {
    await source.close()
    await target.close()
  }
} catch (error) {
  console.error(redactSecrets(describe(error), secrets))
  if (!(error instanceof CopyRefusedError)) {
    console.error(
      'The copy failed. Drop the PostgreSQL database, create it again empty and retry; ' +
        'the SQLite database was not changed.',
    )
  }
  process.exit(1)
}
