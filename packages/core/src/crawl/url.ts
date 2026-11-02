import { createHash } from 'node:crypto'

export {
  MAX_CRAWL_URL_LENGTH,
  isInternalUrl,
  normalizeCrawlUrl,
  parsePriorityUrl,
} from './normalize'

/** Stable key of a URL. URLs can be too long to index directly on every database. */
export function crawlUrlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 32)
}
