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
      reset: async () => {
        for (const table of [
          'jobs',
          'worker_heartbeats',
          'settings',
          'user',
          'crawl_url_issues',
          'crawl_links',
          'crawl_urls',
          'crawls',
          'crawl_schedules',
          'crawl_settings',
          'priority_urls',
          'domain_favicons',
          'crawl_files',
          'crawl_file_checks',
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
