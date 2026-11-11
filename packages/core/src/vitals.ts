import { createLogger } from './logger'
import type { Settings } from './settings'
import { z } from './zod'

export const GOOGLE_VITALS_KEY = 'integrations.google-vitals-key'
export const googleVitalsKeySchema = z.string().trim().min(1).max(500)
export async function loadVitalsKey(settings: Settings): Promise<string | null> {
  const result = await settings.readJson(GOOGLE_VITALS_KEY, googleVitalsKeySchema)
  if (result.state === 'undecryptable')
    createLogger('vitals').warn('Saved Google vitals key is unreadable; enter it again')
  return result.state === 'ready' ? result.value : null
}
export interface VitalMetrics {
  lcp: number | null
  inp: number | null
  cls: number | null
  fcp: number | null
  ttfb: number | null
  tbt: number | null
}
export const emptyVitals = (): VitalMetrics => ({
  lcp: null,
  inp: null,
  cls: null,
  fcp: null,
  ttfb: null,
  tbt: null,
})
export type VitalsFailure =
  'no-key' | 'quota' | 'forbidden' | 'network' | 'timeout' | 'http' | 'invalid-response'
export class VitalsError extends Error {
  constructor(
    readonly category: VitalsFailure,
    readonly retryAfterMs?: number,
  ) {
    super(category)
  }
}
const value = z.union([
  z.number().nonnegative().finite(),
  z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .transform(Number)
    .pipe(z.number().nonnegative().finite()),
])
const metric = z.object({ percentiles: z.object({ p75: value.optional() }).optional() })
const cruxSchema = z.object({
  record: z.object({ metrics: z.record(z.string(), metric).optional() }),
})
const psiSchema = z.object({
  lighthouseResult: z.object({
    audits: z.record(
      z.string(),
      z.object({ numericValue: z.number().nonnegative().finite().optional() }),
    ),
  }),
})
const names = {
  lcp: 'largest_contentful_paint',
  inp: 'interaction_to_next_paint',
  cls: 'cumulative_layout_shift',
  fcp: 'first_contentful_paint',
  ttfb: 'experimental_time_to_first_byte',
} as const
export function parseCrux(body: unknown): VitalMetrics {
  const metrics = cruxSchema.parse(body).record.metrics ?? {}
  return {
    ...emptyVitals(),
    ...Object.fromEntries(
      Object.entries(names).map(([key, name]) => [key, metrics[name]?.percentiles?.p75 ?? null]),
    ),
  }
}
export function parsePsi(body: unknown): VitalMetrics {
  const audits = psiSchema.parse(body).lighthouseResult.audits
  return {
    ...emptyVitals(),
    lcp: audits['largest-contentful-paint']?.numericValue ?? null,
    cls: audits['cumulative-layout-shift']?.numericValue ?? null,
    tbt: audits['total-blocking-time']?.numericValue ?? null,
    fcp: audits['first-contentful-paint']?.numericValue ?? null,
  }
}
function retryAfter(header: string | null): number {
  if (!header) return 60_000
  const seconds = Number(header)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()
  return Number.isFinite(ms) ? Math.max(1000, ms) : 60_000
}
/** Fixed hosts, no redirects, bounded streamed bodies. Never propagate a fetch or Google error. */
export function createVitalsClient(key: string, fetcher: typeof fetch = fetch) {
  async function request(
    url: URL,
    init: RequestInit,
    lab: boolean,
    signal?: AbortSignal,
  ): Promise<VitalMetrics | null> {
    const timeout = AbortSignal.timeout(lab ? 90_000 : 15_000)
    try {
      const response = await fetcher(url, {
        ...init,
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
      const reader = response.body?.getReader()
      if (!reader) throw new VitalsError('invalid-response')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const part = await reader.read()
          if (part.done) break
          size += part.value.byteLength
          if (size > (lab ? 8 : 1) * 1024 * 1024) throw new VitalsError('invalid-response')
          chunks.push(part.value)
        }
      } finally {
        await reader.cancel().catch(() => {})
      }
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!response.ok) {
          const failure = z
            .object({
              error: z.object({
                details: z.array(z.object({ reason: z.string().optional() })).optional(),
                errors: z.array(z.object({ reason: z.string().optional() })).optional(),
              }),
            })
            .safeParse(body)
          const reasons = failure.success
            ? [...(failure.data.error.details ?? []), ...(failure.data.error.errors ?? [])].map(
                (e) => e.reason,
              )
            : []
          const forbidden = reasons.some(
            (reason) =>
              reason === 'PERMISSION_DENIED' ||
              reason === 'API_KEY_INVALID' ||
              reason === 'API_KEY_SERVICE_BLOCKED' ||
              reason === 'API_KEY_HTTP_REFERRER_BLOCKED' ||
              reason === 'API_KEY_IP_ADDRESS_BLOCKED' ||
              reason === 'keyInvalid' ||
              reason === 'accessNotConfigured',
          )
          const quota =
            response.status === 429 ||
            reasons.some(
              (reason) =>
                reason === 'RATE_LIMIT_EXCEEDED' ||
                reason === 'QUOTA_EXCEEDED' ||
                reason === 'dailyLimitExceeded' ||
                reason === 'rateLimitExceeded',
            )
          if (quota) throw new VitalsError('quota', retryAfter(response.headers.get('retry-after')))
          if (forbidden) throw new VitalsError('forbidden')
          return null
        }
        return lab ? parsePsi(body) : parseCrux(body)
      } catch (error) {
        if (error instanceof VitalsError) throw error
        if (!response.ok) {
          if (response.status === 429)
            throw new VitalsError('quota', retryAfter(response.headers.get('retry-after')))
          return null
        }
        throw new VitalsError('invalid-response')
      }
    } catch (error) {
      if (error instanceof VitalsError) throw error
      throw new VitalsError(timeout.aborted ? 'timeout' : 'network')
    }
  }
  return {
    crux(
      target: { origin: string } | { url: string },
      formFactor: 'PHONE' | 'DESKTOP',
      signal?: AbortSignal,
    ) {
      const url = new URL('https://chromeuxreport.googleapis.com/v1/records:queryRecord')
      url.searchParams.set('key', key)
      return request(
        url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...target, formFactor, metrics: Object.values(names) }),
        },
        false,
        signal,
      )
    },
    psi(target: string, signal?: AbortSignal) {
      const url = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed')
      url.search = new URLSearchParams({
        url: target,
        strategy: 'mobile',
        category: 'performance',
        key,
      }).toString()
      return request(url, {}, true, signal)
    },
  }
}
