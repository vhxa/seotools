import { isConfigurationReason, isComparisonReason } from '@seotools/core/crawl/comparison-reasons'

/** URL hashes as the crawler stores them. */
const HASH = /^[0-9a-f]{32}$/

export type CheckRequest =
  | {
      ok: true
      from: string
      to: string
      side: 'base' | 'target'
      urlHashes: string[]
    }
  | { ok: false; error: 'none' | 'tooMany' }

/**
 * What "Check now" received, checked before anything else: the raw list is bounded first (a list
 * longer than `max` is refused whole, before it is read), then only well-formed hashes are kept,
 * once each.
 */
export function parseCheckRequest(input: unknown, max: number): CheckRequest {
  if (!input || typeof input !== 'object') return { ok: false, error: 'none' }
  const { from, to, side, urlHashes } = input as Record<string, unknown>
  if (!Array.isArray(urlHashes)) return { ok: false, error: 'none' }
  if (urlHashes.length > max) return { ok: false, error: 'tooMany' }
  if (typeof from !== 'string' || typeof to !== 'string' || (side !== 'base' && side !== 'target'))
    return { ok: false, error: 'none' }
  const hashes = [
    ...new Set(
      urlHashes.filter((hash): hash is string => typeof hash === 'string' && HASH.test(hash)),
    ),
  ]
  if (hashes.length === 0) return { ok: false, error: 'none' }
  return { ok: true, from, to, side, urlHashes: hashes }
}

/**
 * Whether a URL belongs to the group "Check now" is offered for: one the `side` crawl has and the
 * other lacks (`inSide`, `inOther`), and, when the pair is explained, not one a setting explains
 * (those are not checked on the site).
 */
export function isCheckable(input: {
  inSide: boolean
  inOther: boolean
  reason: string | null | undefined
}): boolean {
  if (!input.inSide || input.inOther) return false
  if (input.reason && isComparisonReason(input.reason) && isConfigurationReason(input.reason))
    return false
  return true
}
