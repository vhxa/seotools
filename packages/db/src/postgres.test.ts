import postgres from 'postgres'
import { createDatabase } from './client'
import { describeDatabaseContract } from './test/contract'

const url = process.env.TEST_POSTGRES_URL

describeDatabaseContract(
  'postgres',
  async () => {
    const db = await createDatabase({ url: url!, dialect: 'pg' })
    await db.migrate()
    const sql = postgres(url!, { max: 1, onnotice: () => {} })
    return {
      db,
      legacy: {
        urlAcceptedNofollow: async (crawlId: string, urlHash: string) => {
          await sql`update crawl_url_audit set accept_nofollow = true where crawl_id = ${crawlId} and url_hash = ${urlHash}`
        },
        acceptNofollow: async (ruleId: string, accept: boolean) => {
          await sql`update audit_rules set accept_nofollow = ${accept} where id = ${ruleId}`
        },
      },
      countRows: async (table: string) => {
        const [row] = await sql.unsafe(`select count(*)::int as n from "${table}"`)
        return Number(row?.n)
      },
      reset: async () => {
        await sql`truncate table jobs, alert_notices, alert_subscriptions, mail_deliveries, worker_heartbeats, settings, user_tokens, user_access, "user", crawl_url_audit, crawl_url_accepted_issues, crawl_url_issues, crawl_sitemap_hreflang, crawl_links, crawl_urls, crawls, crawl_schedules, crawl_settings, url_verification_urls, url_verifications, priority_urls, domain_favicons, crawl_files, crawl_file_checks, audit_rules, domain_audit_config, domains, companies cascade`
      },
    }
  },
  { skip: !url },
)
