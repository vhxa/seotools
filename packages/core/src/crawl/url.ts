import { stripIgnoredParameters } from './normalize'
import { createHash } from 'node:crypto'

export {
  MAX_CRAWL_URL_LENGTH,
  isInternalUrl,
  normalizeCrawlUrl,
  parsePriorityUrl,
  stripIgnoredParameters,
  matchesIgnoredParameter,
} from './normalize'

/** Stable key of a URL. URLs can be too long to index directly on every database. */
export function crawlUrlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 32)
}

/** Resolve a written address using the identity rules of the crawl being browsed. */
export function crawlIdentityHash(
  url: string,
  crawl: { ignoredParameters?: readonly string[] },
  host: string,
): string {
  return crawlUrlHash(stripIgnoredParameters(url, crawl.ignoredParameters ?? [], host))
}
