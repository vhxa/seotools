'use server'

import { EXTRACTION_LIMITS } from '@seotools/core/crawl/extraction'
import {
  CRAWL_SETTINGS_LIMITS,
  domainRequestSettings,
  requestSettingsSchema,
  EMPTY_REQUEST_SETTINGS,
  settingsKeyFrom,
  crawlUrlHash,
  nextScheduledRun,
  parsePriorityUrl,
  type CrawlType,
} from '@seotools/core'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import {
  parseCrawlScheduleForm,
  parseCrawlSettingsForm,
  parseListCrawlForm,
} from '@/lib/crawl-forms'
import { getDb } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { archivedMessage, requireDomainEditor } from '@/lib/workspace'

export interface ActionState {
  error?: string
  /** Set after a successful save, to confirm it to the user. */
  saved?: boolean
}

export interface AddPriorityUrlState {
  error?: string
  /** Echoed back so a failed submit doesn't wipe what the user typed. */
  value?: string
}

/** Where priority pages are listed (settings) and where they can be starred (pages). */
function revalidatePriorityUrls(host: string) {
  revalidatePath(`/domains/${host}/pages`)
  revalidatePath(`/domains/${host}/pages/details`)
  revalidatePath(`/domains/${host}/settings/priority`)
}

function revalidateDomain(host: string) {
  revalidatePath(`/domains/${host}/pages`)
  revalidatePath(`/domains/${host}/jobs`)
}

/** Starts a crawl now. A domain only runs one at a time, whatever its type. */
export async function startCrawlAction(
  host: string,
  type: CrawlType,
  _previous: ActionState,
): Promise<ActionState> {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  const t = await getTranslations('Crawl.errors')
  const db = await getDb()

  if (type === 'priority' && (await db.priorityUrls.list(domain.id)).length === 0) {
    return { error: t('noPriorityUrls') }
  }
  const crawl = await db.crawls.start({ domainId: domain.id, type, trigger: 'manual' })
  if (!crawl) return { error: t('alreadyRunning') }

  revalidateDomain(host)
  return {}
}

export async function cancelCrawlAction(host: string, crawlId: string) {
  const { domain } = await requireDomainEditor(host)
  const db = await getDb()
  // The id comes from the client: it has to be a crawl of the domain being acted on.
  const crawl = await db.crawls.get(crawlId)
  if (crawl?.domainId === domain.id) await db.crawls.cancel(crawl.id)
  revalidateDomain(host)
}

/** Marks or unmarks a URL as a priority one. */
export async function setPriorityUrlAction(host: string, url: string, marked: boolean) {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return
  const db = await getDb()
  const normalized = parsePriorityUrl(url, domain.host)
  if (!normalized) return
  if (marked) await db.priorityUrls.add({ domainId: domain.id, url: normalized })
  else await db.priorityUrls.remove({ domainId: domain.id, urlHash: crawlUrlHash(normalized) })
  revalidatePriorityUrls(host)
}

/** Most URLs a single call marks or unmarks: a page of the pages table is far below it. */
const MAX_BULK_URLS = 200

/** Marks or unmarks several URLs at once. URLs that are not of the domain are skipped. */
export async function setPriorityUrlsAction(host: string, urls: string[], marked: boolean) {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return
  const db = await getDb()
  for (const url of urls.slice(0, MAX_BULK_URLS)) {
    const normalized = parsePriorityUrl(url, domain.host)
    if (!normalized) continue
    if (marked) await db.priorityUrls.add({ domainId: domain.id, url: normalized })
    else await db.priorityUrls.remove({ domainId: domain.id, urlHash: crawlUrlHash(normalized) })
  }
  revalidatePriorityUrls(host)
}

export async function addPriorityUrlAction(
  host: string,
  _previous: AddPriorityUrlState,
  formData: FormData,
): Promise<AddPriorityUrlState> {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  const t = await getTranslations('Crawl.errors')
  const value = String(formData.get('url') ?? '')
  const url = parsePriorityUrl(value, domain.host)
  if (!url) return { error: t('invalidPriorityUrl', { host: domain.host }), value }

  await (await getDb()).priorityUrls.add({ domainId: domain.id, url })
  revalidatePriorityUrls(host)
  return {}
}

export async function saveScheduleAction(
  host: string,
  type: CrawlType,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  const t = await getTranslations('Crawl.errors')
  const parsed = parseCrawlScheduleForm(formData)
  if (!parsed.ok) return { error: t('invalidSchedule') }

  await (
    await getDb()
  ).crawlSchedules.save({
    ...parsed.recurrence,
    domainId: domain.id,
    type,
    enabled: parsed.enabled,
    nextRunAt: nextScheduledRun(parsed.recurrence, new Date()),
  })
  revalidatePath(`/domains/${host}/jobs`)
  return { saved: true }
}

export async function saveCrawlSettingsAction(
  host: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  const t = await getTranslations('CrawlSettings.errors')
  const limits = CRAWL_SETTINGS_LIMITS
  const parsed = parseCrawlSettingsForm(formData)
  if (!parsed.ok) {
    switch (parsed.error) {
      case 'scope':
        return { error: t('scope') }
      case 'extractors':
        return { error: t('extractors', { max: EXTRACTION_LIMITS.extractors }) }
      case 'renderingUnavailable':
        return { error: t('renderingUnavailable') }
      case 'userAgent':
        return { error: t('userAgent', { max: limits.userAgentLength }) }
      case 'concurrency':
        return { error: t('concurrency', limits.concurrency) }
      case 'requestsPerSecond':
        return { error: t('requestsPerSecond', limits.requestsPerSecond) }
      case 'timeout':
        return { error: t('timeout', limits.timeoutSeconds) }
      case 'maxRetries':
        return { error: t('maxRetries', limits.maxRetries) }
      case 'maxUrls':
        return { error: t('maxUrls', limits.maxUrls) }
      case 'retainCrawls':
        return { error: t('retainCrawls', limits.retainCrawls) }
      case 'historyDays':
        return { error: t('historyDays', limits.historyDays) }
      case 'indexNowKey':
        return { error: t('indexNowKey') }
      case 'indexNowKeyRequired':
        return { error: t('indexNowKeyRequired') }
    }
  }

  const db = await getDb()
  const secretStore = domainRequestSettings(db.crawls, domain.id, settingsKeyFrom(getEnv()))
  const previousSecrets =
    (await secretStore.getJson('request', requestSettingsSchema)) ?? EMPTY_REQUEST_SETTINGS
  const headerText = String(formData.get('requestHeaders') ?? '').trim()
  const headers = headerText
    ? headerText.split(/\r?\n/).map((line) => {
        const colon = line.indexOf(':')
        return {
          name: colon < 0 ? '' : line.slice(0, colon).trim(),
          value: line.slice(colon + 1).trim(),
        }
      })
    : previousSecrets.headers
  const credentials = requestSettingsSchema.safeParse(
    formData.get('clearRequestSecrets') === 'on'
      ? EMPTY_REQUEST_SETTINGS
      : {
          headers,
          username: String(formData.get('basicUsername') ?? '').trim() || previousSecrets.username,
          password: String(formData.get('basicPassword') ?? '') || previousSecrets.password,
        },
  )
  if (!credentials.success) return { error: t('requestSecrets') }
  const previous = await db.crawls.settings(domain.id)
  await db.crawls.saveSettings(domain.id, parsed.settings)
  if (credentials.data.headers.length || credentials.data.username || credentials.data.password) {
    await secretStore.setJson('request', credentials.data, { encrypted: true })
  } else await secretStore.delete('request')
  // Whoever just turned a file on should not have to wait a day to see it.
  const filesChanged =
    previous.indexNowKey !== parsed.settings.indexNowKey ||
    previous.optionalFiles.join() !== parsed.settings.optionalFiles.join()
  if (filesChanged) await db.crawlFiles.requestCheck({ domainId: domain.id, now: new Date() })
  revalidatePath(`/domains/${host}/settings/crawl`)
  // The sidebar lists the files that are turned on, and it belongs to a layout above the domain.
  if (filesChanged) revalidatePath('/', 'layout')
  return { saved: true }
}

/** Asks the worker to request the domain's crawl files again, without a crawl. */
export async function refreshCrawlFilesAction(
  host: string,
  _previous: ActionState,
): Promise<ActionState> {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  const t = await getTranslations('CrawlFiles.refresh')
  const db = await getDb()
  if ((await db.crawls.active(domain.id))?.type === 'full') return { error: t('crawlRunning') }
  await db.crawlFiles.requestCheck({ domainId: domain.id, now: new Date() })
  revalidatePath(`/domains/${host}/crawl-files`, 'layout')
  return {}
}

export async function startListCrawlAction(
  host: string,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  const t = await getTranslations('Crawl.errors')
  const list = parseListCrawlForm(form, domain.host)
  if (!list.ok)
    return {
      error: list.error === 'limit' ? t('listLimit') : t('listInvalid', { count: list.count }),
    }
  const seedUrls = list.urls
  const crawl = await (
    await getDb()
  ).crawls.start({ domainId: domain.id, type: 'priority', trigger: 'manual', seedUrls })
  if (!crawl) return { error: t('alreadyRunning') }
  revalidateDomain(host)
  return { saved: true }
}
