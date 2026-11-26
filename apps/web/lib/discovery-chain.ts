import type { CrawlLinkKind } from '@seotools/core'
import type { DiscoveryStep } from '@seotools/db'

/** One sentence of "How it was found": `from` reached `to` through a link of `kind`. */
export interface DiscoverySentence {
  from: DiscoveryStep
  to: DiscoveryStep
  /** `null`: the crawl did not record how `from` led to `to`; it is never guessed. */
  kind: CrawlLinkKind | null
  isLast: boolean
}

/**
 * The steps of a discovery path as sentences. A step's `foundKind` says how the crawl reached it
 * from the step before, so each sentence takes the kind of the step it leads to: "`from` {relation}
 * `to`". `earlierMissing` is true when the first step was itself found from another URL the path
 * does not have (a path cut short): what came before is not recorded.
 */
export function discoverySentences(steps: readonly DiscoveryStep[]): {
  sentences: DiscoverySentence[]
  earlierMissing: boolean
} {
  const sentences = steps.slice(1).map((to, index) => ({
    from: steps[index] as DiscoveryStep,
    to,
    kind: to.foundKind,
    isLast: index === steps.length - 2,
  }))
  return { sentences, earlierMissing: steps.length > 0 && steps[0]?.foundKind != null }
}
