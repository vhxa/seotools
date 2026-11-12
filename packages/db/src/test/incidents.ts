import { expect, it } from 'vitest'
import { createCompany } from '../workspace'
import type { Database, NewCrawlFile } from '../types'
import { incidentAlertJobId, vitalsAlertJobId } from '../mapping'
export function describeIncidents(getDb: () => Database) {
  it('records incidents atomically, opens once, moves last-seen, claims/releases, resolves, prunes and deletes jobs', async () => {
    const db = getDb(),
      created = await createCompany(db, { name: 'Example', domain: 'example.com' })
    if (!created.ok) throw new Error('setup')
    const domainId = created.domain.id
    const user = await db.users.create({
      name: 'Member',
      email: 'incidents@example.com',
      role: 'member',
    })
    const now = new Date('2026-01-01T00:00:00Z')
    const file: NewCrawlFile = {
      url: 'https://example.com/robots.txt',
      kind: 'robots',
      statusCode: 200,
      body: 'User-agent: *',
      contentType: 'text/plain',
      redirectTo: null,
      bytes: 10,
      truncated: false,
      error: null,
      data: null,
      via: 'refresh',
      fetchedAt: now,
    }
    await db.crawlFiles.save(domainId, [file])
    expect(await db.incidents.list(domainId)).toEqual([])
    const blocked = { ...file, body: 'User-agent: *\nDisallow: /' }
    await db.crawlFiles.save(domainId, [blocked])
    const [incident] = await db.incidents.list(domainId)
    expect(incident?.kind).toBe('robots-blocks-site')
    const later = new Date(now.getTime() + 3600000)
    await db.crawlFiles.save(domainId, [{ ...blocked, fetchedAt: later }])
    expect(await db.incidents.list(domainId)).toMatchObject([
      { id: incident!.id, lastSeenAt: later },
    ])
    expect(await db.jobs.get(incidentAlertJobId(incident!.id, 'open'))).not.toBeNull()
    expect(await db.incidents.claim(incident!.id, user.id, 'open')).toBe(true)
    expect(await db.incidents.claim(incident!.id, user.id, 'open')).toBe(false)
    await db.incidents.release(incident!.id, user.id, 'open')
    expect(await db.incidents.claim(incident!.id, user.id, 'open')).toBe(true)
    await db.crawlFiles.save(domainId, [{ ...file, fetchedAt: later }])
    expect(await db.incidents.list(domainId)).toEqual([])
    expect((await db.incidents.get(incident!.id))?.resolvedAt).toEqual(later)
    expect(await db.jobs.get(incidentAlertJobId(incident!.id, 'resolved'))).not.toBeNull()
    await db.incidents.prune(new Date(later.getTime() + 1))
    expect(await db.incidents.get(incident!.id)).toBeNull()
    await db.crawlFiles.save(domainId, [blocked])
    const [open] = await db.incidents.list(domainId)
    const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    await db.vitals.queueAlerts(crawl!.id)
    await db.domains.delete(domainId)
    expect(await db.incidents.get(open!.id)).toBeNull()
    expect(await db.jobs.get(incidentAlertJobId(open!.id, 'open'))).toBeNull()
    expect(await db.jobs.get(vitalsAlertJobId(crawl!.id))).toBeNull()
  })
}
