export interface AnchorObservation {
  digest: string
  count: number
  /** Sorted, distinct crawl URL identities, at most 64. */
  hashes: string[]
}

export interface Answer {
  at: string
  status: number | null
  media: string | null
  location: string | null
  html: {
    title: string | null
    titleDigest: string
    textDigest: string
    anchors: AnchorObservation
  } | null
}

export type ChangedField = 'status' | 'media' | 'title' | 'text' | 'anchors'
export interface AnswerPair {
  version: 1
  sourceHash: string
  original: Answer
  repeat: Answer | null
  unknown: 'request-context' | 'transport' | 'retry-after' | 'incomplete' | null
  changed: ChangedField[]
  examples: { side: 'original' | 'repeat'; hash: string; label: string }[]
}
export interface PairSummary {
  version: 1
  eligible: number
  selected: number
  comparable: number
  different: number
  unknown: Partial<Record<NonNullable<AnswerPair['unknown']>, number>>
  examples: string[]
}

export function changedFields(a: Answer, b: Answer): ChangedField[] {
  const changes: ChangedField[] = []
  if (a.status !== null && b.status !== null && a.status !== b.status) changes.push('status')
  if (a.media !== null && b.media !== null && a.media !== b.media) changes.push('media')
  if (a.html && b.html) {
    if (a.html.titleDigest !== b.html.titleDigest) changes.push('title')
    if (a.html.textDigest !== b.html.textDigest) changes.push('text')
    if (a.html.anchors.digest !== b.html.anchors.digest) changes.push('anchors')
  }
  return changes
}

/** WP4 supplies the retained discovery join and its coverage/configuration decision. */
export function discoveryLinkVaried(input: {
  comparableCompletedCrawls: boolean
  discoveredCrawlId: string
  missingCrawlId: string
  discovery: {
    crawlId: string
    sourceHash: string
    targetHash: string
    kind: string
    rendered: boolean
  } | null
  missing: { crawlId: string; pair: AnswerPair } | null
  targetHash: string
}): boolean {
  const { discovery, missing, targetHash } = input
  if (
    !input.comparableCompletedCrawls ||
    !discovery ||
    !missing ||
    input.discoveredCrawlId === input.missingCrawlId ||
    discovery.crawlId !== input.discoveredCrawlId ||
    missing.crawlId !== input.missingCrawlId ||
    discovery.rendered ||
    !['anchor', 'anchor-nofollow'].includes(discovery.kind) ||
    discovery.targetHash !== targetHash ||
    discovery.sourceHash !== missing.pair.sourceHash ||
    missing.pair.unknown ||
    !missing.pair.changed.includes('anchors')
  )
    return false
  const before = missing.pair.original.html?.anchors
  const after = missing.pair.repeat?.html?.anchors
  return (
    !!before &&
    !!after &&
    before.count === before.hashes.length &&
    !before.hashes.includes(targetHash) &&
    after.hashes.includes(targetHash)
  )
}
