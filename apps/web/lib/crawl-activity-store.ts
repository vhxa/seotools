import { IDLE, newest, type CrawlActivity } from '@/lib/crawl-activity'

/**
 * What the browser last learnt of each domain's crawling, outside React. The page's own render
 * (the layout draws again after a refresh or an action) and the polls both report readings, and
 * React may render a component with older props while a newer render is pending: reading the
 * newest reading from here, instead of keeping it in component state, means an older one can never
 * put the button back. It also survives the button being mounted again.
 */
const readings = new Map<string, CrawlActivity>()
const listeners = new Set<() => void>()

export function readActivity(host: string): CrawlActivity {
  return readings.get(host) ?? IDLE
}

/** Records a reading unless a later one is already known. */
export function offerActivity(host: string, incoming: CrawlActivity): void {
  const current = readActivity(host)
  const next = newest(current, incoming)
  if (next === current) return
  readings.set(host, next)
  for (const listener of listeners) listener()
}

export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** For tests. */
export function resetActivity(): void {
  readings.clear()
  listeners.clear()
}
