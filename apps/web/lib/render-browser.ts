import {
  DEFAULT_CRAWL_SETTINGS,
  RENDER_STATUS_KEY,
  readRenderStatus,
  renderStatusSchema,
} from '@seotools/core'
import { getSettings } from './settings'

/** Fresh worker evidence only; missing, unreadable or stale status never enables rendering. */
export async function renderBrowserStatus() {
  const stored = await (
    await getSettings()
  )
    .getJson(RENDER_STATUS_KEY, renderStatusSchema)
    .catch(() => null)
  return readRenderStatus(stored)
}

export async function newDomainCrawlSettings() {
  return {
    ...DEFAULT_CRAWL_SETTINGS,
    renderingMode:
      (await renderBrowserStatus())?.state === 'ready' ? ('headless' as const) : ('http' as const),
  }
}
