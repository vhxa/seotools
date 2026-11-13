import { DEFAULT_CRAWL_SETTINGS } from '@seotools/core'
import { describe, expect, it } from 'vitest'
import {
  parseExtractors,
  parseCrawlScheduleForm,
  parseCrawlSettingsForm,
  parseListCrawlForm,
} from './crawl-forms'

const formOf = (values: Record<string, string | undefined>) => {
  const form = new FormData()
  form.set('collectVitals', 'on')
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
  retainCrawls: '2',
  historyDays: '30',
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

  it('reads the optional crawl files and the IndexNow key', () => {
    const result = parseCrawlSettingsForm(
      formOf({
        ...validSettings,
        'file.ads': 'on',
        'file.feed': 'on',
        'file.nonsense': 'on',
        'file.indexnow': 'on',
        indexNowKey: ' abcd-1234 ',
      }),
    )
    expect(result).toMatchObject({
      ok: true,
      settings: { optionalFiles: ['ads', 'feed'], indexNowKey: 'abcd-1234' },
    })
  })

  it('forgets the IndexNow key while its switch is off, whatever the field holds', () => {
    expect(
      parseCrawlSettingsForm(formOf({ ...validSettings, indexNowKey: 'abcd-1234' })),
    ).toMatchObject({ ok: true, settings: { indexNowKey: null } })
    expect(
      parseCrawlSettingsForm(formOf({ ...validSettings, indexNowKey: 'not valid!' })),
    ).toMatchObject({ ok: true, settings: { indexNowKey: null } })
  })

  it.each(['', '   '])('asks for the key when IndexNow is on and it is %j', (indexNowKey) => {
    expect(
      parseCrawlSettingsForm(formOf({ ...validSettings, 'file.indexnow': 'on', indexNowKey })),
    ).toEqual({ ok: false, error: 'indexNowKeyRequired' })
    expect(parseCrawlSettingsForm(formOf({ ...validSettings, 'file.indexnow': 'on' }))).toEqual({
      ok: false,
      error: 'indexNowKeyRequired',
    })
  })

  it.each(['short', 'not valid!', `${'a'.repeat(129)}`, '../../etc/passwd'])(
    'refuses %s as an IndexNow key',
    (indexNowKey) => {
      expect(
        parseCrawlSettingsForm(formOf({ ...validSettings, 'file.indexnow': 'on', indexNowKey })),
      ).toEqual({
        ok: false,
        error: 'indexNowKey',
      })
    },
  )

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

describe('list crawl input', () => {
  it('normalizes and deduplicates only same-site URLs', () => {
    expect(
      parseListCrawlForm(
        formOf({
          urls: 'https://example.com/a#x\nhttps://example.com/a\nhttp://www.example.com/b',
        }),
        'example.com',
      ),
    ).toEqual({ ok: true, urls: ['https://example.com/a', 'http://www.example.com/b'] })
    expect(
      parseListCrawlForm(
        formOf({
          urls: 'https://other.com/a\nhttps://sub.example.com/\nhttps://example.com:8443/',
        }),
        'example.com',
      ),
    ).toEqual({ ok: false, error: 'invalid', count: 3 })
  })
  it('bounds a list before deduplication', () => {
    expect(parseListCrawlForm(formOf({ urls: '' }), 'example.com')).toEqual({
      ok: false,
      error: 'limit',
    })
    expect(
      parseListCrawlForm(
        formOf({ urls: Array(1001).fill('https://example.com/').join('\n') }),
        'example.com',
      ),
    ).toEqual({ ok: false, error: 'limit' })
    expect(
      parseListCrawlForm(
        formOf({ urls: Array(1000).fill('https://example.com/').join('\n') }),
        'example.com',
      ).ok,
    ).toBe(true)
  })
})

it('reads scope and depth and rejects invalid values', () => {
  expect(
    parseCrawlSettingsForm(
      formOf({
        ...validSettings,
        includePrefixes: '/shop/\n/news',
        excludePrefixes: '/shop/private',
        maxDepth: '3',
      }),
    ),
  ).toMatchObject({
    ok: true,
    settings: {
      includePrefixes: ['/shop', '/news'],
      excludePrefixes: ['/shop/private'],
      maxDepth: 3,
    },
  })
  expect(parseCrawlSettingsForm(formOf({ ...validSettings, maxDepth: '101' }))).toEqual({
    ok: false,
    error: 'scope',
  })
})

describe('parseExtractors', () => {
  it('reads one extractor per line, with an optional attribute and a key from the name', () => {
    expect(
      parseExtractors('Price | meta[property="product:price"] | content\n\n Author | .author '),
    ).toEqual([
      {
        key: 'price',
        name: 'Price',
        selector: 'meta[property="product:price"]',
        attribute: 'content',
      },
      { key: 'author', name: 'Author', selector: '.author', attribute: null },
    ])
    expect(parseExtractors('')).toEqual([])
  })

  it('refuses a line without a name or with a selector that is not CSS', () => {
    expect(parseExtractors(' | .price')).toBeNull()
    expect(parseExtractors('Price | [broken')).toBeNull()
  })
})

it('refuses rendered mode without fresh ready evidence, but always allows HTML', () => {
  const form = formOf({ ...validSettings, renderingMode: 'headless' })
  expect(parseCrawlSettingsForm(form, false)).toEqual({ ok: false, error: 'renderingUnavailable' })
  expect(parseCrawlSettingsForm(form, true).ok).toBe(true)
  form.set('renderingMode', 'http')
  expect(parseCrawlSettingsForm(form, false).ok).toBe(true)
})
it.each(['https://example.com', 'bad host.test', '*.example.com', 'example.com/path', '-bad.test'])(
  'rejects invalid omitted hostname %s',
  (host) => {
    expect(parseCrawlSettingsForm(formOf({ ...validSettings, renderOmittedHosts: host }))).toEqual({
      ok: false,
      error: 'renderSettings',
    })
  },
)
