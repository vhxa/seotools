import { describe, expect, it } from 'vitest'
import { assessIndexability, type IndexabilityInput } from './indexability'

const page = (overrides: Partial<IndexabilityInput> = {}): IndexabilityInput => ({
  state: 'done',
  kind: 'page',
  statusCode: 200,
  noindex: false,
  canonicalised: false,
  robotsBlocked: false,
  ...overrides,
})

describe('assessIndexability', () => {
  it('finds a page that answered with nothing in the way indexable', () => {
    expect(assessIndexability(page())).toEqual({ state: 'indexable', blockers: [] })
  })

  it.each([
    ['noindex', { noindex: true }],
    ['canonical', { canonicalised: true }],
    ['robots', { robotsBlocked: true }],
  ] as const)('finds a page with %s not indexable', (blocker, overrides) => {
    expect(assessIndexability(page(overrides))).toEqual({
      state: 'not-indexable',
      blockers: [blocker],
    })
  })

  it('lists every blocker, not just the first', () => {
    expect(
      assessIndexability(page({ noindex: true, canonicalised: true, robotsBlocked: true })),
    ).toEqual({ state: 'not-indexable', blockers: ['noindex', 'canonical', 'robots'] })
  })

  it('finds redirects and error statuses not indexable', () => {
    expect(assessIndexability(page({ kind: 'redirect', statusCode: 301 }))).toEqual({
      state: 'not-indexable',
      blockers: ['redirect'],
    })
    expect(assessIndexability(page({ statusCode: 404 }))).toEqual({
      state: 'not-indexable',
      blockers: ['http-error'],
    })
    expect(assessIndexability(page({ statusCode: 503, noindex: true }))).toEqual({
      state: 'not-indexable',
      blockers: ['http-error', 'noindex'],
    })
  })

  describe('does not know', () => {
    it('for a URL that was not requested', () => {
      for (const state of ['queued', 'skipped'] as const) {
        expect(assessIndexability(page({ state, statusCode: null }))).toEqual({
          state: 'unknown',
          blockers: [],
        })
      }
    })

    it('for a request that failed, however many blockers it seems to have', () => {
      expect(assessIndexability(page({ statusCode: null, noindex: true }))).toEqual({
        state: 'unknown',
        blockers: [],
      })
    })

    it('for something that is not a page and has nothing in the way', () => {
      expect(assessIndexability(page({ kind: 'resource' }))).toEqual({
        state: 'unknown',
        blockers: [],
      })
    })
  })

  it('does not depend on anything but the crawl: the audit and the findings are not inputs', () => {
    // A signature check as much as a behaviour one: nothing about exclusions can reach it.
    expect(Object.keys(page()).sort()).toEqual(
      ['canonicalised', 'kind', 'noindex', 'robotsBlocked', 'state', 'statusCode'].sort(),
    )
  })
})
