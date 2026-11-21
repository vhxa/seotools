import { CURRENT_CAPTURE_RULE, captureProvesAbsence } from '@seotools/core/crawl/render-state'
import { describe, expect, it } from 'vitest'
import { renderEvidence } from './explain'
import type { CounterpartRender } from './types'

const row = (data: string, overrides: Partial<CounterpartRender> = {}): CounterpartRender => ({
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
