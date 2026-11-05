import mysql from 'mysql2/promise'
import { createDatabase } from './client'
import { describeDatabaseContract } from './test/contract'

const url = process.env.TEST_MYSQL_URL

describeDatabaseContract(
  'mysql',
  async () => {
    const db = await createDatabase({ url: url!, dialect: 'mysql' })
    await db.migrate()
    const conn = await mysql.createConnection(url!)
    return {
      db,
      legacy: {
        urlAcceptedNofollow: async (crawlId: string, urlHash: string) => {
          await conn.query(
            'update crawl_url_audit set accept_nofollow = 1 where crawl_id = ? and url_hash = ?',
            [crawlId, urlHash],
          )
        },
        acceptNofollow: async (ruleId: string, accept: boolean) => {
          await conn.query('update audit_rules set accept_nofollow = ? where id = ?', [
            accept ? 1 : 0,
            ruleId,
          ])
        },
      },
      reset: async () => {
        for (const table of [
          'jobs',
          'worker_heartbeats',
          'settings',
          'user',
          'crawl_url_audit',
          'crawl_url_accepted_issues',
          'crawl_url_issues',
          'crawl_sitemap_hreflang',
          'crawl_links',
          'crawl_urls',
          'crawls',
          'crawl_schedules',
          'crawl_settings',
          'url_verification_urls',
          'url_verifications',
          'priority_urls',
          'domain_favicons',
          'crawl_files',
          'crawl_file_checks',
          'audit_rules',
          'domain_audit_config',
          'domains',
          'companies',
        ]) {
          await conn.query(`delete from \`${table}\``)
        }
      },
    }
  },
  { skip: !url },
)
