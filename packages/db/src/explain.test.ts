import { CURRENT_CAPTURE_RULE, captureProvesAbsence } from '@seotools/core/crawl/render-state'
import { describe, expect, it } from 'vitest'
import { COUNTERPART_CACHE, LINK_PAGE, explainPair, renderEvidence } from './explain'
import type { Database, ExplainedUrl, InLink, RenderRow } from './types'

const row = (data: string, overrides: Partial<RenderRow> = {}): RenderRow => ({
  urlHash: 'h',
  status: 'rendered',
  settled: true,
  truncated: false,
  data,
  ...overrides,
})
const current = {
  capture: { rule: CURRENT_CAPTURE_RULE, pending: 0, afterMs: 5000, delayMs: 2 },
  requests: { failedCount: 0 },
}

describe('renderEvidence', () => {
  it('reads a stored render as WP1 does and lets its rule decide', () => {
    expect(renderEvidence(row(JSON.stringify(current)), false, captureProvesAbsence)).toEqual({
      state: 'complete',
      provesAbsence: true,
    })
    // The served HTML was cut: the render is `truncated`, whatever its capture says.
    expect(renderEvidence(row(JSON.stringify(current)), true, captureProvesAbsence)).toEqual({
      state: 'truncated',
      provesAbsence: false,
    })
    // A redirect stored in the data, and a capture while loading.
    expect(
      renderEvidence(
        row(JSON.stringify({ ...current, redirected: true })),
        false,
        captureProvesAbsence,
      ).state,
    ).toBe('redirect')
    expect(
      renderEvidence(row(JSON.stringify(current), { settled: false }), false, captureProvesAbsence),
    ).toEqual({ state: 'unsettled', provesAbsence: false })
  })

  it('reads a stray escaped NUL in stored text like any other character', () => {
    const data = JSON.stringify({ ...current, page: { title: 'A\u0000B' } })
    expect(renderEvidence(row(data), false, captureProvesAbsence).provesAbsence).toBe(true)
  })

  it('fails closed on data it cannot read', () => {
    for (const data of ['', '{', 'null', '[]', '"text"', '{"capture": ']) {
      expect(renderEvidence(row(data), false, captureProvesAbsence), data).toEqual({
        state: 'unknown',
        provesAbsence: false,
      })
    }
    // A rule that throws proves nothing.
    expect(
      renderEvidence(row(JSON.stringify(current)), false, () => {
        throw new Error('broken')
      }).provesAbsence,
    ).toBe(false)
  })
})

/**
 * Fix round 2, finding 8 (probe counterpart-cache-rollover): a fake store whose first in-link pages
 * fill the caches with exactly `COUNTERPART_CACHE` linking pages; the last page links URL 2 from a
 * page already cached (seq 3) and from a new one, which makes the caches roll over.
 */
function rollover(options: { rendered: boolean; failingSource: boolean }) {
  const pages = COUNTERPART_CACHE / LINK_PAGE
  let read = 0
  const saved = new Map<number, ExplainedUrl>()
  const page = { state: 'done', kind: 'page', statusCode: 200, notRequested: null, servedTruncated: false }
  const crawl = {
    domainId: 'd',
    ref: 1,
    pruned: false,
    status: 'completed',
    ignoredParameters: [],
    rendering: { mode: options.rendered ? 'rendered' : 'html', waitMs: 1000, omittedHosts: [] },
    discoverySettings: {
      userAgent: 'test',
      requestCredentialsSet: false,
      timeoutMs: 1000,
      includePrefixes: [],
      excludePrefixes: [],
    },
  }
  const link = (target: number, source: number): InLink => ({
    target,
    source,
    kind: 'anchor',
    rendered: options.rendered,
  })
  const db = {
    crawls: {
      get: async (id: string) => ({ ...crawl, id }),
      comparisonWork: {
        begin: async () => true,
        oneSided: async ({ side, after }: { side: string; after: string | null }) =>
          side === 'base' && after === null
            ? [1, 2].map((seq) => ({
                seq,
                urlHash: `hash${seq}`,
                url: `https://probe.example/${seq}`,
                source: 'link',
                foundVia: null,
                foundFrom: null,
                foundKind: null,
              }))
            : [],
        inLinks: async () => {
          const start = read++ * LINK_PAGE
          if (start < COUNTERPART_CACHE)
            return Array.from({ length: LINK_PAGE }, (_, i) => link(1, 3 + start + i))
          return [link(2, 3), link(2, COUNTERPART_CACHE + 3)]
        },
        counterparts: async ({ sources }: { sources: number[] }) =>
          sources.map((source) => ({
            source,
            identityChanged: false,
            own: { ...page, urlHash: `source${source}` },
            other: {
              ...page,
              urlHash: `source${source}`,
              statusCode: options.failingSource && source === 3 ? 503 : 200,
            },
          })),
        renders: async ({ urlHashes }: { urlHashes: string[] }): Promise<RenderRow[]> =>
          urlHashes.map((urlHash) => ({
            urlHash,
            status: 'rendered',
            settled: true,
            truncated: false,
            data: '{}',
          })),
        save: async ({ rows }: { rows: ExplainedUrl[] }) => {
          for (const row of rows) saved.set(row.seq!, row)
        },
        pending: async () => [],
        finish: async () => true,
      },
    },
  } as unknown as Database
  return { db, saved }
}

describe('the caches of linking pages and renders', () => {
  it('keeps every linking page the current page of links needs when it rolls over', async () => {
    const { db, saved } = rollover({ rendered: false, failingSource: true })
    await explainPair({ db, baseId: 'b', targetId: 't', runner: 'rollover' })
    expect(saved.get(2)).toMatchObject({ reason: 'notReached', detail: 'failed', via: 3, sources: 2 })
  }, 60_000)

  it('keeps every render the current page of links needs when it rolls over', async () => {
    const { db, saved } = rollover({ rendered: true, failingSource: false })
    await explainPair({
      db,
      baseId: 'b',
      targetId: 't',
      runner: 'rollover',
      captureTrust: () => true,
    })
    expect(saved.get(2)).toMatchObject({ reason: 'unlinked', via: 3, sources: 2 })
  }, 60_000)
})
