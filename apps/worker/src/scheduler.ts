import { nextScheduledRun, type Logger } from '@seotools/core'
import type { CrawlSchedule, CrawlScheduleOutcome, Database } from '@seotools/db'

const DUE_BATCH = 100

async function fire(db: Database, schedule: CrawlSchedule): Promise<CrawlScheduleOutcome> {
  if (schedule.type === 'priority') {
    const priorities = await db.priorityUrls.list(schedule.domainId)
    if (priorities.length === 0) return 'skipped-empty'
  }
  const crawl = await db.crawls.start({
    domainId: schedule.domainId,
    type: schedule.type,
    trigger: 'schedule',
  })
  return crawl ? 'started' : 'skipped-active'
}

/**
 * Starts the crawls that are due, and cleans up after crawls whose job gave up. A worker that was
 * down catches up with one run per schedule, not with every run it missed.
 */
export async function runDueSchedules(db: Database, log: Logger, now = new Date()) {
  const orphaned = await db.crawls.failOrphaned()
  if (orphaned > 0) log.warn({ orphaned }, 'failed crawls whose job gave up')

  for (const schedule of await db.crawlSchedules.due({ now, limit: DUE_BATCH })) {
    const claimed = await db.crawlSchedules.advance({
      id: schedule.id,
      expectedNextRunAt: schedule.nextRunAt,
      nextRunAt: nextScheduledRun(schedule, now),
      now,
    })
    // Another worker got to this run first.
    if (!claimed) continue
    const outcome = await fire(db, schedule)
    await db.crawlSchedules.recordOutcome({ id: schedule.id, outcome })
    log.info({ scheduleId: schedule.id, type: schedule.type, outcome }, 'scheduled crawl fired')
  }
}
