import type { CrawlType } from '@seotools/core'
import type { CrawlSchedule } from '@seotools/db'
import type { ScheduleFormValues } from '@/components/crawl/schedule-form'

/** What the form starts with before a schedule exists: priority pages get checked more often. */
const DEFAULT_SCHEDULES: Record<CrawlType, ScheduleFormValues> = {
  full: {
    enabled: false,
    frequency: 'weekly',
    time: '03:00',
    dayOfWeek: 1,
    dayOfMonth: 1,
    timeZone: null,
  },
  priority: {
    enabled: false,
    frequency: 'daily',
    time: '06:00',
    dayOfWeek: 1,
    dayOfMonth: 1,
    timeZone: null,
  },
}

const pad = (value: number) => String(value).padStart(2, '0')

/** The values a schedule form shows: the saved schedule, or the starting ones. */
export function scheduleFormValues(
  type: CrawlType,
  schedule: CrawlSchedule | undefined,
): ScheduleFormValues {
  if (!schedule) return DEFAULT_SCHEDULES[type]
  return {
    enabled: schedule.enabled,
    frequency: schedule.frequency,
    time: `${pad(schedule.hour)}:${pad(schedule.minute)}`,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    timeZone: schedule.timeZone,
  }
}
