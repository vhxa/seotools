import {
  INDEXNOW_KEY,
  OPTIONAL_CRAWL_FILES,
  CRAWL_RENDERING_AVAILABLE,
  CRAWL_RENDERING_MODES,
  CRAWL_SETTINGS_LIMITS,
  crawlRecurrenceSchema,
  crawlSettingsSchema,
  type CrawlRecurrence,
  type CrawlRenderingMode,
  type CrawlSettings,
} from '@seotools/core'

export type CrawlSettingsFormError =
  | 'renderingUnavailable'
  | 'userAgent'
  | 'concurrency'
  | 'requestsPerSecond'
  | 'timeout'
  | 'maxRetries'
  | 'maxUrls'
  | 'retainCrawls'
  | 'indexNowKey'
  | 'indexNowKeyRequired'

export type CrawlSettingsFormResult =
  { ok: true; settings: CrawlSettings } | { ok: false; error: CrawlSettingsFormError }

export type CrawlScheduleFormResult =
  { ok: true; enabled: boolean; recurrence: CrawlRecurrence } | { ok: false }

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim()

/** A whole number, or `NaN` for anything else: `Number('')` and `Number('1e3')` are too lenient. */
const integer = (value: string) => (/^\d+$/.test(value) ? Number(value) : Number.NaN)

const inRange = (value: number, { min, max }: { min: number; max: number }) =>
  Number.isInteger(value) && value >= min && value <= max

/** Validates the crawl settings form. Modes that are not implemented yet are refused here too. */
export function parseCrawlSettingsForm(form: FormData): CrawlSettingsFormResult {
  const limits = CRAWL_SETTINGS_LIMITS

  const mode = text(form, 'renderingMode') as CrawlRenderingMode
  if (!CRAWL_RENDERING_MODES.includes(mode) || !CRAWL_RENDERING_AVAILABLE.includes(mode)) {
    return { ok: false, error: 'renderingUnavailable' }
  }

  const concurrency = integer(text(form, 'concurrency'))
  if (!inRange(concurrency, limits.concurrency)) return { ok: false, error: 'concurrency' }
  const requestsPerSecond = integer(text(form, 'requestsPerSecond'))
  if (!inRange(requestsPerSecond, limits.requestsPerSecond)) {
    return { ok: false, error: 'requestsPerSecond' }
  }
  const timeoutSeconds = integer(text(form, 'timeoutSeconds'))
  if (!inRange(timeoutSeconds, limits.timeoutSeconds)) return { ok: false, error: 'timeout' }
  const maxRetries = integer(text(form, 'maxRetries'))
  if (!inRange(maxRetries, limits.maxRetries)) return { ok: false, error: 'maxRetries' }

  const maxUrlsText = text(form, 'maxUrls')
  const maxUrls = maxUrlsText === '' ? null : integer(maxUrlsText)
  if (maxUrls !== null && !inRange(maxUrls, limits.maxUrls)) return { ok: false, error: 'maxUrls' }

  let retainCrawls: number | null
  switch (text(form, 'retention')) {
    case 'all':
      retainCrawls = null
      break
    case 'current':
      retainCrawls = 1
      break
    case 'latest':
      retainCrawls = integer(text(form, 'retainCrawls'))
      if (!inRange(retainCrawls, limits.retainCrawls)) return { ok: false, error: 'retainCrawls' }
      break
    default:
      return { ok: false, error: 'retainCrawls' }
  }

  // The key is only read while its switch is on: turning IndexNow off forgets it.
  const indexNowOn = form.get('file.indexnow') === 'on'
  const indexNowKey = text(form, 'indexNowKey')
  if (indexNowOn) {
    if (indexNowKey === '') return { ok: false, error: 'indexNowKeyRequired' }
    if (!INDEXNOW_KEY.test(indexNowKey)) return { ok: false, error: 'indexNowKey' }
  }

  const userAgent = text(form, 'userAgent')
  const parsed = crawlSettingsSchema.safeParse({
    renderingMode: mode,
    userAgent: userAgent === '' ? null : userAgent,
    concurrency,
    requestsPerSecond,
    timeoutMs: timeoutSeconds * 1000,
    maxRetries,
    maxUrls,
    retainCrawls,
    optionalFiles: OPTIONAL_CRAWL_FILES.filter((kind) => form.get(`file.${kind}`) === 'on'),
    indexNowKey: indexNowOn ? indexNowKey : null,
  })
  // Everything else was checked above, so the only way to get here is the User-Agent.
  if (!parsed.success) return { ok: false, error: 'userAgent' }
  return { ok: true, settings: parsed.data }
}

/** Validates the schedule form. Fields of other frequencies keep whatever value they hold. */
export function parseCrawlScheduleForm(form: FormData): CrawlScheduleFormResult {
  const time = /^(\d{1,2}):(\d{2})$/.exec(text(form, 'time'))
  const parsed = crawlRecurrenceSchema.safeParse({
    frequency: text(form, 'frequency'),
    hour: Number(time?.[1] ?? Number.NaN),
    minute: Number(time?.[2] ?? Number.NaN),
    dayOfWeek: integer(text(form, 'dayOfWeek')),
    dayOfMonth: integer(text(form, 'dayOfMonth')),
    timeZone: text(form, 'timeZone'),
  })
  if (!parsed.success) return { ok: false }
  return { ok: true, enabled: form.get('enabled') === 'on', recurrence: parsed.data }
}
