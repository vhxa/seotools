import { DEFAULT_CRAWL_SETTINGS } from '@seotools/core'
import { describe, expect, it } from 'vitest'
import { parseCrawlScheduleForm, parseCrawlSettingsForm } from './crawl-forms'

const formOf = (values: Record<string, string | undefined>) => {
  const form = new FormData()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) form.set(key, value)
  }
  return form
}

const validSettings = {
  renderingMode: 'http',
  userAgent: '',
  concurrency: '2',
  requestsPerSecond: '5',
  timeoutSeconds: '30',
  maxRetries: '2',
  maxUrls: '100000',
  retention: 'latest',
  retainCrawls: '10',
}

describe('parseCrawlSettingsForm', () => {
  it('reads the defaults back', () => {
    expect(parseCrawlSettingsForm(formOf(validSettings))).toEqual({
      ok: true,
      settings: DEFAULT_CRAWL_SETTINGS,
    })
  })

  it('reads an empty limit as no limit', () => {
    const result = parseCrawlSettingsForm(formOf({ ...validSettings, maxUrls: '' }))
    expect(result).toMatchObject({ ok: true, settings: { maxUrls: null } })
  })

  it.each([
    ['latest', '3', 3],
    ['current', 'ignored', 1],
    ['all', 'ignored', null],
  ])('reads retention %s', (retention, retainCrawls, expected) => {
    const result = parseCrawlSettingsForm(formOf({ ...validSettings, retention, retainCrawls }))
    expect(result).toMatchObject({ ok: true, settings: { retainCrawls: expected } })
  })

  it('keeps a custom User-Agent', () => {
    const result = parseCrawlSettingsForm(formOf({ ...validSettings, userAgent: ' MyBot/1.0 ' }))
    expect(result).toMatchObject({ ok: true, settings: { userAgent: 'MyBot/1.0' } })
  })

  it.each([
    [{ renderingMode: 'headless' }, 'renderingUnavailable'],
    [{ renderingMode: 'both' }, 'renderingUnavailable'],
    [{ renderingMode: 'nonsense' }, 'renderingUnavailable'],
    [{ concurrency: '0' }, 'concurrency'],
    [{ concurrency: '21' }, 'concurrency'],
    [{ concurrency: '' }, 'concurrency'],
    [{ concurrency: '1.5' }, 'concurrency'],
    [{ requestsPerSecond: '0' }, 'requestsPerSecond'],
    [{ requestsPerSecond: '1e3' }, 'requestsPerSecond'],
    [{ timeoutSeconds: '0' }, 'timeout'],
    [{ timeoutSeconds: '121' }, 'timeout'],
    [{ maxRetries: '6' }, 'maxRetries'],
    [{ maxUrls: '0' }, 'maxUrls'],
    [{ maxUrls: '-5' }, 'maxUrls'],
    [{ retention: 'latest', retainCrawls: '0' }, 'retainCrawls'],
    [{ retention: 'nonsense' }, 'retainCrawls'],
    [{ userAgent: 'evil\r\nX-Injected: 1' }, 'userAgent'],
    [{ userAgent: 'x'.repeat(256) }, 'userAgent'],
    [{ userAgent: 'Señor Bot' }, 'userAgent'],
  ])('refuses %j', (overrides, error) => {
    expect(parseCrawlSettingsForm(formOf({ ...validSettings, ...overrides }))).toEqual({
      ok: false,
      error,
    })
  })
})

const validSchedule = {
  enabled: 'on',
  frequency: 'weekly',
  time: '04:30',
  dayOfWeek: '2',
  dayOfMonth: '15',
  timeZone: 'Europe/Madrid',
}

describe('parseCrawlScheduleForm', () => {
  it('reads a schedule', () => {
    expect(parseCrawlScheduleForm(formOf(validSchedule))).toEqual({
      ok: true,
      enabled: true,
      recurrence: {
        frequency: 'weekly',
        hour: 4,
        minute: 30,
        dayOfWeek: 2,
        dayOfMonth: 15,
        timeZone: 'Europe/Madrid',
      },
    })
  })

  it('treats an unchecked switch as disabled', () => {
    const result = parseCrawlScheduleForm(formOf({ ...validSchedule, enabled: undefined }))
    expect(result).toMatchObject({ ok: true, enabled: false })
  })

  it.each([
    { frequency: 'yearly' },
    { time: '' },
    { time: '25:00' },
    { time: '10:75' },
    { time: 'noon' },
    { dayOfWeek: '7' },
    { dayOfMonth: '31' },
    { timeZone: 'Mars/Base' },
    { timeZone: '' },
  ])('refuses %j', (overrides) => {
    expect(parseCrawlScheduleForm(formOf({ ...validSchedule, ...overrides }))).toEqual({
      ok: false,
    })
  })
})
