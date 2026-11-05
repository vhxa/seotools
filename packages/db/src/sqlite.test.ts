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
    reset: async () => {
      const raw = (db.orm.db as { $client: { exec: (sql: string) => void } }).$client
      raw.exec(
        'delete from jobs; delete from worker_heartbeats; delete from settings; delete from user; delete from crawl_url_audit; delete from crawl_url_accepted_issues; delete from crawl_url_issues; delete from crawl_sitemap_hreflang; delete from crawl_links; delete from crawl_urls; delete from crawls; delete from crawl_schedules; delete from crawl_settings; delete from url_verification_urls; delete from url_verifications; delete from priority_urls; delete from domain_favicons; delete from crawl_files; delete from crawl_file_checks; delete from audit_rules; delete from domain_audit_config; delete from domains; delete from companies;',
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
    ['mysql://u:p@h:3306/db', 'mysql'],
    ['mariadb://u:p@h/db', 'mysql'],
  ])('%s → %s', (url, dialect) => {
    expect(detectDialect(url)).toBe(dialect)
  })

  it('honours an explicit dialect and rejects unknown schemes', () => {
    expect(detectDialect('whatever', 'pg')).toBe('pg')
    expect(() => detectDialect('mongodb://localhost/x')).toThrow(/DATABASE_DIALECT/)
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
