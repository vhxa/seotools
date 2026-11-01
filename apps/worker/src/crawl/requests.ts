/** Longest pause a `Retry-After` header can impose. */
const MAX_RETRY_AFTER_MS = 5 * 60_000

export const RETRY_BASE_MS = 1000
export const RETRYABLE_STATUS = new Set([429, 503])
/** Errors that will fail the same way on a second try, seconds later. */
export const PERMANENT_ERRORS = new Set([
  'BLOCKED_ADDRESS',
  'ENOTFOUND',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
])

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

/** `Retry-After` is either seconds or an HTTP date. */
export function parseRetryAfter(value: string | undefined): number | null {
  if (!value) return null
  const seconds = Number(value)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : new Date(value).getTime() - Date.now()
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : null
}

export const isRedirect = (status: number) => status >= 300 && status < 400 && status !== 304
