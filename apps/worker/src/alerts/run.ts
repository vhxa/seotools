import {
  alertEmail,
  alertLocaleOf,
  appLink,
  domainRoleOf,
  sortedAlertKinds,
  type AlertKind,
  type AlertLocale,
  type FindingsNotice,
  type ChangeSummary,
  type Logger,
  type Mailer,
} from '@seotools/core'
import type { Crawl, Database, Domain } from '@seotools/db'
import { deliver } from '../mail/deliver'
import { JobDeferredError, JobInterruptedError, PermanentJobError } from '../types'
import { compareWithPrevious, type CrawlComparison } from './changes'
import { issueName } from './issue-names'

/** How long a crawl may wait to be analysed before its findings are given up on. */
export const ANALYSIS_WAIT_MS = 2 * 60 * 60_000
const DEFERRED_MS = 30_000

/** The kinds that make sense for a crawl that ended like this. */
function kindsFor(status: 'completed' | 'incomplete' | 'failed'): AlertKind[] {
  if (status === 'failed') return ['crawl-problem']
  if (status === 'incomplete') return ['crawl-problem', 'change-summary']
  return ['important-findings', 'change-summary']
}

export interface AlertsOutcome {
  /** Why nothing was done at all. */
  skipped?: 'not-applicable' | 'gone' | 'archived' | 'nobody'
  /** Emails sent in this attempt. */
  sent?: number
  /** People who asked for something and are not sent it any more, or were already sent it. */
  left?: number
}

interface Recipient {
  userId: string
  email: string
  locale: AlertLocale
  kinds: AlertKind[]
}

/**
 * Tells the people who asked about a full crawl that ended. Who gets what is decided here, when it
 * is sent, never when the job was queued: someone who lost access, was disabled or opted out since
 * receives nothing, and that is not a failure. A kind is handed to a person once per crawl
 * (`db.alerts.claim`), so a retried job, a crash or two workers never send twice, and all the kinds a
 * person has for the crawl go in one email.
 *
 * Only the end of a full crawl queues this (`db.crawls.finish`): analysing a crawl again for new rules
 * or a new catalog never does, and a change that only the rules explain is `unverified` in the
 * comparison, so it is never reported here as a regression.
 */
export async function runCrawlAlerts(input: {
  db: Database
  log: Logger
  signal: AbortSignal
  crawlId: string
  publicUrl: string | undefined
  getMailer: () => Promise<Mailer | null>
  now?: Date
}): Promise<AlertsOutcome> {
  const { db, log, signal, crawlId } = input
  const now = input.now ?? new Date()
  const crawl = await db.crawls.get(crawlId)
  const domain = crawl ? await db.domains.get(crawl.domainId) : null
  if (!crawl || !domain) return { skipped: 'gone' }
  const status = crawl.status
  // Only a full crawl that ended says something; a cancelled one or one still running does not.
  if (
    crawl.type !== 'full' ||
    (status !== 'completed' && status !== 'incomplete' && status !== 'failed')
  ) {
    return { skipped: 'not-applicable' }
  }
  const applicable = kindsFor(status)
  // An archived domain keeps its data and sends nothing.
  if (domain.archivedAt) return { skipped: 'archived' }

  const asked = (await db.alerts.forDomain(domain.id)).map((subscription) => subscription.userId)
  const eligible = (userId: string) => recipientFor(db, domain, applicable, userId)
  const candidates = (await Promise.all(asked.map(eligible))).filter((r) => r !== null)
  if (candidates.length === 0) return { skipped: 'nobody' }

  const publicUrl = input.publicUrl
  if (!publicUrl) {
    // Only now, with someone to write to: an installation nobody subscribed on needs no address.
    throw new PermanentJobError(
      'BETTER_AUTH_URL is not set in the worker: no link to the app can be made',
    )
  }

  // Findings come from the analysis that follows the end of the crawl.
  const needsFindings = status !== 'failed'
  let unanalysed = false
  if (needsFindings && crawl.pagesByWorstIssue === null) {
    const finishedAt = crawl.finishedAt ?? crawl.createdAt
    if (now.getTime() - finishedAt.getTime() < ANALYSIS_WAIT_MS) {
      throw new JobDeferredError(DEFERRED_MS, 'The crawl has not been analysed yet')
    }
    // Given up on: an unanalysed crawl has no findings to compare, so nothing about them is said.
    unanalysed = true
    log.warn(
      { crawlId, status },
      'the crawl was never analysed: its findings are not compared, only a crawl problem is reported',
    )
  }

  const comparison =
    needsFindings && !unanalysed ? await compareWithPrevious({ db, target: crawl, signal }) : null

  let sent = 0
  let left = 0
  let failure: unknown
  for (const { userId } of candidates) {
    if (signal.aborted) throw new JobInterruptedError()
    // Once more, right before: the comparison may have taken a while.
    const recipient = await eligible(userId)
    if (!recipient) {
      left++
      continue
    }
    const kinds = recipient.kinds.filter((kind) =>
      unanalysed
        ? kind === 'crawl-problem'
        : kind !== 'important-findings' || (comparison?.important.length ?? 0) > 0,
    )
    const taken = kinds.length
      ? await db.alerts.claim({ crawlId, userId: recipient.userId, kinds })
      : []
    if (taken.length === 0) {
      left++
      continue
    }
    try {
      await deliver({
        db,
        log,
        mailer: await input.getMailer(),
        kind: 'alert',
        to: recipient.email,
        content: async () =>
          alertEmail({
            locale: recipient.locale,
            host: domain.host,
            kinds: taken,
            crawl: {
              status,
              finishedAt: crawl.finishedAt ?? crawl.createdAt,
              error: crawl.error,
              pages: crawl.pagesCount,
              urls: crawl.urlsCount,
            },
            links: {
              history: appLink(publicUrl, `/domains/${domain.host}/pages/history`),
              crawlSettings: appLink(publicUrl, `/domains/${domain.host}/settings/crawl`),
            },
            ...(comparison
              ? sectionsOf(comparison, { crawl, domain, publicUrl, locale: recipient.locale })
              : {}),
          }),
      })
      sent++
    } catch (error) {
      // Given back, so that the next attempt sends it; the others are not held up by this one.
      await db.alerts
        .release({ crawlId, userId: recipient.userId, kinds: taken })
        .catch((err) => log.warn({ err }, 'could not give back an alert'))
      failure ??= error
    }
  }
  if (failure) throw failure
  return { sent, left }
}

/**
 * What a person may be sent about this domain right now: what they asked for, if their account is
 * active and they can still see the domain. `null`: nothing, and that is not an error.
 */
async function recipientFor(
  db: Database,
  domain: Domain,
  applicable: readonly AlertKind[],
  userId: string,
): Promise<Recipient | null> {
  const subscription = (await db.alerts.forUser(userId)).find((s) => s.domainId === domain.id)
  if (!subscription) return null
  const kinds = sortedAlertKinds(subscription.kinds.filter((kind) => applicable.includes(kind)))
  if (kinds.length === 0) return null
  const user = await db.users.get(userId)
  if (!user || user.disabledAt) return null
  const grants = await db.users.grantsOf(user.id)
  if (domainRoleOf({ role: user.role, grants }, domain) === null) return null
  return { userId: user.id, email: user.email, locale: alertLocaleOf(subscription.locale), kinds }
}

/** The comparison as the sections of an email, in the person's language. */
function sectionsOf(
  comparison: CrawlComparison,
  context: { crawl: Crawl; domain: Domain; publicUrl: string; locale: AlertLocale },
): { findings?: FindingsNotice; summary?: ChangeSummary } {
  const { crawl, domain, publicUrl, locale } = context
  const { base } = comparison
  const compareHref = base
    ? appLink(
        publicUrl,
        `/domains/${domain.host}/pages/compare?${new URLSearchParams({ from: base.id, to: crawl.id, change: 'gained' })}`,
      )
    : ''
  const out: { findings?: FindingsNotice; summary?: ChangeSummary } = {}
  if (base && comparison.important.length > 0) {
    out.findings = {
      since: base.finishedAt ?? base.createdAt,
      cut: comparison.cut,
      compareHref,
      groups: comparison.important.map((tally) => ({
        name: issueName(locale, tally.issue),
        count: tally.count,
        fresh: tally.fresh,
        back: tally.back,
        samples: tally.samples,
        href: appLink(
          publicUrl,
          `/domains/${domain.host}/pages/details?${new URLSearchParams({ crawl: crawl.id, issue: tally.issue })}`,
        ),
      })),
    }
  }
  if (comparison.state === 'first') out.summary = { state: 'first', pages: crawl.pagesCount }
  else if (comparison.state === 'no-base' || !base) out.summary = { state: 'no-base' }
  else {
    out.summary = {
      state: 'compared',
      since: base.finishedAt ?? base.createdAt,
      urls: comparison.urls,
      findings: comparison.findings,
      notes: comparison.notes,
      cut: comparison.cut,
      compareHref,
    }
  }
  return out
}
