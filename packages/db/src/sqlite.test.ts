import { describe, expect, it } from 'vitest'
import { detectDialect, sqlitePathFromUrl } from './dialect'
import { describeDatabaseContract } from './test/contract'
import { createTestDatabase } from './test'

describeDatabaseContract('sqlite', async () => {
  const db = await createTestDatabase()
  return {
    db,
    legacy: {
      urlAcceptedNofollow: async (crawlId: string, urlHash: string) => {
        const raw = (
          db.orm.db as {
            $client: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } }
          }
        ).$client
        raw
          .prepare(
            'update crawl_url_audit set accept_nofollow = 1 where crawl_id = ? and url_hash = ?',
          )
          .run(crawlId, urlHash)
      },
      acceptNofollow: async (ruleId: string, accept: boolean) => {
        const raw = (
          db.orm.db as {
            $client: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } }
          }
        ).$client
        raw
          .prepare('update audit_rules set accept_nofollow = ? where id = ?')
          .run(accept ? 1 : 0, ruleId)
      },
    },
    countRows: async (table: string) => {
      const raw = (
        db.orm.db as {
          $client: { prepare: (sql: string) => { get: () => unknown } }
        }
      ).$client
      const row = raw.prepare(`select count(*) as n from "${table}"`).get() as { n: number }
      return row.n
    },
    reset: async () => {
      const raw = (db.orm.db as { $client: { exec: (sql: string) => void } }).$client
      raw.exec(
        'delete from jobs; delete from alert_notices; delete from alert_subscriptions; delete from mail_deliveries; delete from worker_heartbeats; delete from settings; delete from user_tokens; delete from user_access; delete from user; delete from crawl_url_audit; delete from crawl_url_accepted_issues; delete from crawl_url_issues; delete from crawl_sitemap_hreflang; delete from crawl_links; delete from crawl_urls; delete from crawls; delete from crawl_schedules; delete from crawl_settings; delete from url_verification_urls; delete from url_verifications; delete from priority_urls; delete from domain_favicons; delete from crawl_files; delete from crawl_file_checks; delete from audit_rules; delete from domain_audit_config; delete from domains; delete from companies;',
      )
    },
  }
})

describe('detectDialect', () => {
  it.each([
    ['file:./data/seotools.db', 'sqlite'],
    ['file:/data/seotools.db', 'sqlite'],
    [':memory:', 'sqlite'],
    ['postgres://u:p@h:5432/db', 'pg'],
    ['postgresql://u:p@h/db', 'pg'],
  ])('%s → %s', (url, dialect) => {
    expect(detectDialect(url)).toBe(dialect)
  })

  it('honours an explicit dialect and rejects unknown schemes', () => {
    expect(detectDialect('whatever', 'pg')).toBe('pg')
    expect(() => detectDialect('mongodb://localhost/x')).toThrow(/DATABASE_DIALECT/)
  })

  it.each(['mysql://u:p@h:3306/db', 'mysql2://u:p@h/db', 'mariadb://u:p@h/db'])(
    'refuses %s: MySQL is no longer supported',
    (url) => {
      expect(() => detectDialect(url)).toThrow(/MySQL is no longer supported.*PostgreSQL/)
      expect(() => detectDialect(url, 'pg')).toThrow(/MySQL is no longer supported/)
    },
  )

  it('keeps the message free of credentials', () => {
    expect(() => detectDialect('mysql://root:hunter2@h/db')).not.toThrow(/hunter2/)
  })
})

describe('sqlitePathFromUrl', () => {
  it.each([
    ['file:./data/a.db', './data/a.db'],
    ['file:/data/a.db', '/data/a.db'],
    ['file:///data/a.db', '/data/a.db'],
    ['file:a.db?mode=rwc', 'a.db'],
    [':memory:', ':memory:'],
  ])('%s → %s', (url, path) => {
    expect(sqlitePathFromUrl(url)).toBe(path)
  })
})
