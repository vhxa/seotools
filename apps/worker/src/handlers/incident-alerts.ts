import {
  alertLocaleOf,
  appLink,
  domainRoleOf,
  incidentAlertsPayload,
  incidentEmail,
  vitalsAlertsPayload,
  vitalsEmail,
  vitalsRegressions,
  type AlertKind,
} from '@seotools/core'
import type { Database, Domain } from '@seotools/db'
import { deliver } from '../mail/deliver'
import { JobInterruptedError, PermanentJobError, type JobHandler } from '../types'

async function recipient(db: Database, domain: Domain, userId: string, kind: AlertKind) {
  const current = await db.domains.get(domain.id)
  if (!current || current.archivedAt) return null
  const sub = (await db.alerts.forUser(userId)).find(
    (s) => s.domainId === domain.id && s.kinds.includes(kind),
  )
  const user = sub ? await db.users.get(userId) : null
  if (
    !sub ||
    !user ||
    user.disabledAt ||
    !domainRoleOf({ role: user.role, grants: await db.users.grantsOf(userId) }, current)
  )
    return null
  const saved = await db.userPreferences.locale(userId)
  return { email: user.email, locale: alertLocaleOf(saved ?? sub.locale) }
}
export function createIncidentAlertsHandler(deps: {
  db: Database
  publicUrl: string | undefined
}): JobHandler {
  return async (job, ctx) => {
    const { incidentId, stage, observedAt, details } = incidentAlertsPayload.parse(job.payload)
    const { db } = deps
    const incident = await db.incidents.get(incidentId)
    const domain = incident && (await db.domains.get(incident.domainId))
    if (!incident || !domain || domain.archivedAt) return
    const kind =
      incident.kind === 'site-down' || incident.kind === 'certificate'
        ? 'site-availability'
        : 'site-files'
    let failure: unknown
    for (const sub of await db.alerts.forDomain(domain.id)) {
      if (ctx.signal.aborted) throw new JobInterruptedError()
      const person = await recipient(db, domain, sub.userId, kind)
      if (!person) continue
      if (!deps.publicUrl) throw new PermanentJobError('BETTER_AUTH_URL is not set')
      if (!(await db.incidents.claim(incidentId, sub.userId, stage))) continue
      try {
        await deliver({
          db,
          log: ctx.log,
          mailer: await ctx.getMailer(),
          kind: 'alert',
          to: person.email,
          content: incidentEmail({
            ...person,
            ...incident,
            stage,
            at: new Date(observedAt),
            details,
            host: domain.host,
            href: appLink(deps.publicUrl, `/domains/${domain.host}/issues`),
          }),
        })
      } catch (error) {
        await db.incidents.release(incidentId, sub.userId, stage)
        failure ??= error
      }
    }
    if (failure) throw failure
  }
}
export async function regressionsFor(db: Database, crawlId: string) {
  const crawl = await db.crawls.get(crawlId)
  if (!crawl || crawl.type !== 'full') return []
  const previous = await db.vitals.latestCrawl(crawl.domainId, crawl.createdAt)
  return previous
    ? vitalsRegressions(await db.vitals.origins(previous.id), await db.vitals.origins(crawl.id))
    : []
}
export function createVitalsAlertsHandler(deps: {
  db: Database
  publicUrl: string | undefined
}): JobHandler {
  return async (job, ctx) => {
    const { crawlId } = vitalsAlertsPayload.parse(job.payload),
      { db } = deps
    const crawl = await db.crawls.get(crawlId),
      domain = crawl && (await db.domains.get(crawl.domainId))
    if (!crawl || !domain || domain.archivedAt) return
    const regressions = await regressionsFor(db, crawlId)
    if (!regressions.length) return
    let failure: unknown
    for (const sub of await db.alerts.forDomain(domain.id)) {
      if (ctx.signal.aborted) throw new JobInterruptedError()
      const person = await recipient(db, domain, sub.userId, 'vitals-regression')
      if (!person) continue
      if (!deps.publicUrl) throw new PermanentJobError('BETTER_AUTH_URL is not set')
      const kinds = await db.alerts.claim({
        crawlId,
        userId: sub.userId,
        kinds: ['vitals-regression'],
      })
      if (!kinds.length) continue
      try {
        await deliver({
          db,
          log: ctx.log,
          mailer: await ctx.getMailer(),
          kind: 'alert',
          to: person.email,
          content: vitalsEmail({
            ...person,
            host: domain.host,
            regressions,
            href: appLink(deps.publicUrl, `/domains/${domain.host}/issues`),
          }),
        })
      } catch (error) {
        await db.alerts.release({ crawlId, userId: sub.userId, kinds })
        failure ??= error
      }
    }
    if (failure) throw failure
  }
}
