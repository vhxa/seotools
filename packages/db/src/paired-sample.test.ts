import type BetterSqlite3 from 'better-sqlite3'
import { expect, it } from 'vitest'
import { createCompany } from './workspace'
import { createTestDatabase } from './test'

it.each([2000, 100000])(
  'chooses the same bounded sample from %i pages in either insertion order',
  async (size) => {
    const db = await createTestDatabase()
    try {
      const company = await createCompany(db, { name: 'Synthetic', domain: 'example.com' })
      if (!company.ok) throw Error('setup failed')
      const raw = (db.orm.db as { $client: BetterSqlite3.Database }).$client
      const insert = raw.prepare(
        "insert into crawl_urls(crawl_id,url_hash,url,scope,state,kind,source,depth,status_code) values (?,?,?,'internal','done','page','link',1,200)",
      )
      for (const reverse of [false, true]) {
        const crawl = (await db.crawls.start({
          domainId: company.domain.id,
          type: 'full',
          trigger: 'manual',
        }))!
        raw.transaction(() => {
          for (let i = 0; i < size; i++) {
            const n = reverse ? size - 1 - i : i
            const key = String(n).padStart(8, '0')
            const query = n % 4 === 0 ? '?page=2' : n % 4 === 1 ? '?sort=date' : ''
            insert.run(crawl.id, key, 'https://example.com/' + key + query)
          }
        })()
        const sample = await db.crawls.pairedCandidates(crawl.id)
        expect(sample.eligible).toBe(size)
        expect(sample.rows.map((row) => Number(row.urlHash))).toEqual([
          0, 4, 8, 12, 16, 20, 24, 28, 1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19, 21,
        ])
        await db.crawls.cancel(crawl.id)
      }
    } finally {
      await db.close()
    }
  },
  30000,
)
