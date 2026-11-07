import { z } from 'zod'

export const CRAWL_FREQUENCIES = ['hourly', 'daily', 'weekly', 'monthly'] as const
export type CrawlFrequency = (typeof CRAWL_FREQUENCIES)[number]

/** When a recurring crawl runs, as wall-clock time in `timeZone`. */
export interface CrawlRecurrence {
  frequency: CrawlFrequency
  /** 0–23. Ignored by `hourly`. */
  hour: number
  /** 0–59. */
  minute: number
  /** 0 (Sunday) – 6. Only used by `weekly`. */
  dayOfWeek: number
  /** 1–28, so that the day exists in every month. Only used by `monthly`. */
  dayOfMonth: number
  /** IANA name, e.g. `Europe/Madrid`. */
  timeZone: string
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

export const crawlRecurrenceSchema = z.object({
  frequency: z.enum(CRAWL_FREQUENCIES),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  dayOfWeek: z.number().int().min(0).max(6),
  dayOfMonth: z.number().int().min(1).max(28),
  timeZone: z.string().min(1).max(100).refine(isValidTimeZone),
})

interface LocalTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function localTime(date: Date, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** Milliseconds `timeZone` is ahead of UTC at `instant`. */
function offsetMs(instant: number, timeZone: string): number {
  const local = localTime(new Date(instant), timeZone)
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  )
  return asUtc - Math.floor(instant / 1000) * 1000
}

/**
 * Ambiguous wall times use the earlier instant, once per local day. Missing wall times shift
 * forward by the size of the DST gap (02:30 becomes 03:30 for a one-hour jump).
 */
function fromLocal(wallClockAsUtc: number, timeZone: string): number {
  const offsets = new Set(
    [-2, -1, 0, 1, 2].map((days) => offsetMs(wallClockAsUtc + days * 86_400_000, timeZone)),
  )
  const candidates = [...offsets].map((offset) => wallClockAsUtc - offset).sort((a, b) => a - b)
  const exact = candidates.filter((t) => t + offsetMs(t, timeZone) === wallClockAsUtc)
  if (exact.length) return exact[0]!
  return candidates.find((t) => t + offsetMs(t, timeZone) > wallClockAsUtc)!
}

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

/** The first time the recurrence fires strictly after `after`. */
export function nextScheduledRun(recurrence: CrawlRecurrence, after: Date): Date {
  const { frequency, hour, minute, dayOfWeek, dayOfMonth, timeZone } = recurrence

  if (frequency === 'hourly') {
    // Hourly runs include both occurrences of a repeated hour. Stepping real minutes also
    // handles zones offset by 30 or 45 minutes.
    const start = Math.floor(after.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS
    for (let t = start; t < start + 2 * HOUR_MS; t += MINUTE_MS) {
      if (localTime(new Date(t), timeZone).minute === minute) return new Date(t)
    }
    throw new Error(`No run found for minute ${minute} in ${timeZone}`)
  }

  const today = localTime(after, timeZone)
  const firstDay = Date.UTC(today.year, today.month - 1, today.day)
  // A month is the longest gap between two runs; two of them cover any `after`.
  for (let i = 0; i < 62; i++) {
    const day = new Date(firstDay + i * DAY_MS)
    if (frequency === 'weekly' && day.getUTCDay() !== dayOfWeek) continue
    if (frequency === 'monthly' && day.getUTCDate() !== dayOfMonth) continue
    const run = fromLocal(day.getTime() + hour * HOUR_MS + minute * MINUTE_MS, timeZone)
    if (run > after.getTime()) return new Date(run)
  }
  throw new Error(`No run found for ${JSON.stringify(recurrence)}`)
}
