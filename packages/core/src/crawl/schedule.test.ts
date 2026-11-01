import { describe, expect, it } from 'vitest'
import { crawlRecurrenceSchema, nextScheduledRun, type CrawlRecurrence } from './schedule'

const base: CrawlRecurrence = {
  frequency: 'daily',
  hour: 3,
  minute: 30,
  dayOfWeek: 1,
  dayOfMonth: 15,
  timeZone: 'UTC',
}
const next = (overrides: Partial<CrawlRecurrence>, after: string) =>
  nextScheduledRun({ ...base, ...overrides }, new Date(after)).toISOString()

describe('nextScheduledRun', () => {
  it('runs later today, or tomorrow once the time has passed', () => {
    expect(next({}, '2026-03-10T01:00:00Z')).toBe('2026-03-10T03:30:00.000Z')
    expect(next({}, '2026-03-10T04:00:00Z')).toBe('2026-03-11T03:30:00.000Z')
  })

  it('is strictly after the given instant, so a run never fires twice', () => {
    expect(next({}, '2026-03-10T03:30:00Z')).toBe('2026-03-11T03:30:00.000Z')
  })

  it('finds the next minute mark for hourly runs', () => {
    expect(next({ frequency: 'hourly', minute: 15 }, '2026-03-10T10:05:00Z')).toBe(
      '2026-03-10T10:15:00.000Z',
    )
    expect(next({ frequency: 'hourly', minute: 15 }, '2026-03-10T10:15:00Z')).toBe(
      '2026-03-10T11:15:00.000Z',
    )
  })

  it('honours half-hour zones on hourly runs', () => {
    expect(
      next({ frequency: 'hourly', minute: 0, timeZone: 'Asia/Kolkata' }, '2026-03-10T10:05:00Z'),
    ).toBe('2026-03-10T10:30:00.000Z')
  })

  it('finds the weekday for weekly runs', () => {
    // 2026-03-10 is a Tuesday.
    expect(next({ frequency: 'weekly', dayOfWeek: 2 }, '2026-03-10T01:00:00Z')).toBe(
      '2026-03-10T03:30:00.000Z',
    )
    expect(next({ frequency: 'weekly', dayOfWeek: 1 }, '2026-03-10T01:00:00Z')).toBe(
      '2026-03-16T03:30:00.000Z',
    )
  })

  it('finds the day for monthly runs, crossing into the next month', () => {
    expect(next({ frequency: 'monthly', dayOfMonth: 15 }, '2026-03-10T01:00:00Z')).toBe(
      '2026-03-15T03:30:00.000Z',
    )
    expect(next({ frequency: 'monthly', dayOfMonth: 5 }, '2026-03-10T01:00:00Z')).toBe(
      '2026-04-05T03:30:00.000Z',
    )
    expect(next({ frequency: 'monthly', dayOfMonth: 28 }, '2026-12-29T01:00:00Z')).toBe(
      '2027-01-28T03:30:00.000Z',
    )
  })

  it('reads the time in the schedule zone, including across DST', () => {
    const madrid = { timeZone: 'Europe/Madrid', hour: 12, minute: 0 }
    // Winter: UTC+1. Summer: UTC+2. Madrid switched on 2026-03-29.
    expect(next(madrid, '2026-03-10T00:00:00Z')).toBe('2026-03-10T11:00:00.000Z')
    expect(next(madrid, '2026-07-10T00:00:00Z')).toBe('2026-07-10T10:00:00.000Z')
    expect(next(madrid, '2026-03-28T12:00:00Z')).toBe('2026-03-29T10:00:00.000Z')
  })

  it('uses the date of the schedule zone, not UTC', () => {
    // Already Wednesday in Tokyo while it is still Tuesday in UTC.
    expect(
      next(
        { frequency: 'weekly', dayOfWeek: 3, hour: 9, minute: 0, timeZone: 'Asia/Tokyo' },
        '2026-03-10T20:00:00Z',
      ),
    ).toBe('2026-03-11T00:00:00.000Z')
  })

  it('still fires when the wall-clock time is skipped by DST', () => {
    const run = next(
      { timeZone: 'Europe/Madrid', hour: 2, minute: 30 },
      '2026-03-29T00:30:00Z', // 01:30 in Madrid; 02:00–03:00 does not exist that night
    )
    expect(new Date(run).getTime()).toBeGreaterThan(new Date('2026-03-29T00:30:00Z').getTime())
    expect(new Date(run).getTime()).toBeLessThan(new Date('2026-03-30T00:30:00Z').getTime())
  })
})

describe('crawlRecurrenceSchema', () => {
  it('accepts a valid recurrence and rejects out-of-range or unknown values', () => {
    expect(crawlRecurrenceSchema.safeParse(base).success).toBe(true)
    expect(crawlRecurrenceSchema.safeParse({ ...base, dayOfMonth: 31 }).success).toBe(false)
    expect(crawlRecurrenceSchema.safeParse({ ...base, hour: 24 }).success).toBe(false)
    expect(crawlRecurrenceSchema.safeParse({ ...base, timeZone: 'Mars/Base' }).success).toBe(false)
  })
})
