import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVitalsClient, emptyVitals, parseCrux, parsePsi } from './vitals'
import { vitalState } from './vitals-state'

afterEach(() => vi.useRealTimers())
describe('recorded Google responses', () => {
  it('parses CrUX percentiles and missing metrics', () => {
    expect(
      parseCrux({
        record: {
          metrics: {
            largest_contentful_paint: { percentiles: { p75: 2400 } },
            cumulative_layout_shift: { percentiles: { p75: '0.12' } },
          },
        },
      }),
    ).toEqual({ ...emptyVitals(), lcp: 2400, cls: 0.12 })
    expect(parseCrux({ record: {} })).toEqual(emptyVitals())
  })
  it('parses PSI numeric audit values only', () => {
    expect(
      parsePsi({
        lighthouseResult: {
          audits: {
            'largest-contentful-paint': { numericValue: 1200, displayValue: '1.2 s' },
            'total-blocking-time': { numericValue: 20 },
          },
        },
      }),
    ).toEqual({ ...emptyVitals(), lcp: 1200, tbt: 20 })
    expect(parsePsi({ lighthouseResult: { audits: {} } })).toEqual(emptyVitals())
    expect(() => parsePsi({ lighthouseResult: { audits: { x: { numericValue: -1 } } } })).toThrow()
  })
  it('treats CrUX 404 as no-data', async () => {
    const client = createVitalsClient(
      'secret',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 })),
    )
    expect(await client.crux({ url: 'https://example.com/' }, 'PHONE')).toBeNull()
  })
  it.each([400, 403, 404, 500, 503])('isolates URL HTTP %s for both APIs', async (status) => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'URL failed' } }),
          { status },
        ),
    )
    const client = createVitalsClient('fixture-key', fetcher)
    expect(await client.crux({ url: 'https://example.com/bad' }, 'PHONE')).toBeNull()
    expect(await client.psi('https://example.com/bad')).toBeNull()
  })
  it.each([
    [400, 'API_KEY_INVALID', 'forbidden'],
    [403, 'API_KEY_SERVICE_BLOCKED', 'forbidden'],
    [429, 'RATE_LIMIT_EXCEEDED', 'quota'],
  ])('recognises key/quota reasons in recorded errors', async (status, reason, category) => {
    const client = createVitalsClient(
      'fixture-key',
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({ error: { status: 'PERMISSION_DENIED', details: [{ reason }] } }),
            { status: Number(status) },
          ),
      ),
    )
    await expect(client.crux({ origin: 'https://example.com' }, 'PHONE')).rejects.toThrow(
      String(category),
    )
  })
  it('scrubs fetch errors including the complete key URL', async () => {
    const client = createVitalsClient(
      'secret',
      vi.fn<typeof fetch>().mockRejectedValue(new Error('https://google.com/?key=secret')),
    )
    await expect(client.psi('https://example.com')).rejects.toThrow('network')
  })
  it('rejects malformed and oversized responses', async () => {
    for (const body of ['{}', 'x'.repeat(1024 * 1024 + 1)]) {
      const client = createVitalsClient(
        'secret',
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      )
      await expect(client.crux({ origin: 'https://example.com' }, 'DESKTOP')).rejects.toThrow(
        'invalid-response',
      )
    }
  })
})
it.each([
  ['lcp', 2500, 4000],
  ['inp', 200, 500],
  ['cls', 0.1, 0.25],
] as const)('classifies %s threshold edges and unknown values', (metric, good, poor) => {
  expect(vitalState(metric, good)).toBe('good')
  expect(vitalState(metric, poor)).toBe('needs-improvement')
  expect(vitalState(metric, poor + 0.001)).toBe('poor')
  expect(vitalState(metric, null)).toBe('no-data')
})

it('times out without propagating request details', async () => {
  const controller = new AbortController()
  const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
  const fetcher = vi.fn<typeof fetch>(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('key=secret')), {
          once: true,
        })
      }),
  )
  const pending = expect(
    createVitalsClient('secret', fetcher).crux({ origin: 'https://example.com' }, 'PHONE'),
  ).rejects.toThrow('timeout')
  controller.abort()
  await pending
  spy.mockRestore()
})
