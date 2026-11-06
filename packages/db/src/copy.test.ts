import { getTableName } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import { createFirstAdmin } from './admin'
import { createDatabase } from './client'
import {
  CopyRefusedError,
  copySqliteToPostgres,
  redactConnectionUrl,
  redactSecrets,
  tablesInCopyOrder,
} from './copy'
import * as sqliteSchema from './schema/sqlite'
import { createTestDatabase } from './test'
import { createCompany } from './workspace'

const baseUrl = process.env.TEST_POSTGRES_URL

describe('tablesInCopyOrder', () => {
  it('lists every table of the schema, parents first', () => {
    const tables = tablesInCopyOrder()
    const names = tables.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.length).toBeGreaterThan(25)
    for (const parent of ['user', 'companies', 'domains', 'crawls']) {
      expect(names).toContain(parent)
    }
    const before = (a: string, b: string) => expect(names.indexOf(a)).toBeLessThan(names.indexOf(b))
    before('user', 'session')
    before('companies', 'domains')
    before('domains', 'crawls')
    before('crawls', 'crawl_urls')
    before('crawls', 'crawl_links')
  })
})

describe('redaction', () => {
  it('takes the password out of URLs and of text that quotes them', () => {
    expect(redactConnectionUrl('postgres://u:s3cret@h:5432/db')).toBe('postgres://u:***@h:5432/db')
    expect(redactConnectionUrl('file:/data/seotools.db')).toBe('file:/data/seotools.db')
    const url = 'postgres://u:p%40ss@h/db'
    expect(redactSecrets('connect to postgres://u:p%40ss@h/db failed: p@ss', [url])).not.toMatch(
      /p%40ss|p@ss/,
    )
  })
})

/** A database of its own on the server, since the contract tests use TEST_POSTGRES_URL at once. */
async function withScratchDatabase(run: (url: string) => Promise<void>) {
  const admin = postgres(baseUrl!, { max: 1, onnotice: () => {} })
  const name = `seotools_copy_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  const url = new URL(baseUrl!)
  url.pathname = `/${name}`
  await admin.unsafe(`create database ${name}`)
  try {
    await run(url.toString())
  } finally {
    await admin.unsafe(`drop database if exists ${name} with (force)`)
    await admin.end()
  }
}

async function seed() {
  const source = await createTestDatabase()
  await createFirstAdmin(source, {
    email: 'admin@acme.com',
    name: 'Ada "the" Admin',
    password: 'a-long-admin-password',
  })
  const created = await createCompany(source, { name: 'Acme', domain: 'acme.com' })
  if (!created.ok) throw new Error('setup failed')
  await source.jobs.enqueue({ type: 'example.echo', payload: { message: 'héllo 🌍\n"quoted"' } })
  await source.settings.set('mail', JSON.stringify({ host: 'smtp.acme.com', port: 587 }), false)
  const crawl = await source.crawls.start({
    domainId: created.domain.id,
    type: 'full',
    trigger: 'manual',
  })
  if (!crawl) throw new Error('no crawl')

  const db = source.orm.db as BetterSQLite3Database
  const fetchedAt = new Date(1_762_000_000_123)
  await db.insert(sqliteSchema.crawlUrls).values([
    {
      crawlId: crawl.id,
      urlHash: 'h1',
      url: 'https://acme.com/',
      scope: 'internal',
      state: 'done',
      kind: 'page',
      source: 'seed',
      depth: 0,
      statusCode: 200,
      title: 'Ünïcode "title" — 🌍\nsecond line',
      data: JSON.stringify({ headings: { h1: ['Hola'] }, nested: { a: [1, 2, { b: null }] } }),
      responseTimeMs: 42,
      bytes: 123_456,
      fetchedAt,
    },
    {
      crawlId: crawl.id,
      urlHash: 'h2',
      url: 'https://acme.com/about',
      scope: 'internal',
      state: 'queued',
      source: 'link',
      depth: 1,
    },
  ])
  await db.insert(sqliteSchema.crawlLinks).values({
    crawlId: crawl.id,
    sourceHash: 'h1',
    targetHash: 'h2',
    kind: 'a',
  })
  return source
}

type Row = Record<string, unknown>
const normalise = (rows: Row[]) =>
  rows
    .map((row) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(row)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => [key, value instanceof Date ? value.getTime() : value]),
        ),
      ),
    )
    .sort()

describe.skipIf(!baseUrl)('copySqliteToPostgres', () => {
  it('copies every table with equal counts and equal rows', async () => {
    const source = await seed()
    await withScratchDatabase(async (url) => {
      const target = await createDatabase({ url, dialect: 'pg' })
      try {
        const seen: string[] = []
        const summary = await copySqliteToPostgres(source, target, {
          batchSize: 1,
          onTable: ({ table, done }) => {
            if (done) seen.push(table)
          },
        })
        expect(seen).toEqual(tablesInCopyOrder().map((t) => t.name))
        expect(summary.every((t) => t.source === t.target)).toBe(true)
        const count = (name: string) => summary.find((t) => t.table === name)?.target
        expect(count('user')).toBe(1)
        expect(count('jobs')).toBeGreaterThanOrEqual(2)
        expect(count('crawl_urls')).toBe(2)
        expect(count('crawl_links')).toBe(1)
        // The mail setting and the record of what audit rules mean.
        expect(count('settings')).toBe(2)

        const sqliteDb = source.orm.db as BetterSQLite3Database
        const pgDb = target.orm.db as PostgresJsDatabase
        for (const pair of tablesInCopyOrder()) {
          const fromSqlite = sqliteDb.select().from(pair.sqlite).all() as Row[]
          const fromPg = (await pgDb.select().from(pair.pg)) as Row[]
          expect(normalise(fromPg), getTableName(pair.pg)).toEqual(normalise(fromSqlite))
        }
      } finally {
        await target.close()
      }
    })
    await source.close()
  })

  it('refuses a target that already has rows, and says which', async () => {
    const source = await seed()
    await withScratchDatabase(async (url) => {
      const target = await createDatabase({ url, dialect: 'pg' })
      try {
        await copySqliteToPostgres(source, target)
        await expect(copySqliteToPostgres(source, target)).rejects.toThrow(
          /not empty.*(user|jobs|companies)/,
        )
        await expect(copySqliteToPostgres(source, target)).rejects.toBeInstanceOf(CopyRefusedError)
      } finally {
        await target.close()
      }
    })
    await source.close()
  })

  it('refuses any direction but SQLite to PostgreSQL', async () => {
    const a = await createTestDatabase()
    const b = await createTestDatabase()
    await expect(copySqliteToPostgres(a, b)).rejects.toThrow(/SQLite to PostgreSQL/)
    await a.close()
    await b.close()
  })
})
