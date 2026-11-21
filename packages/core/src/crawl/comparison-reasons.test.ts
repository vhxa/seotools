import { describe, expect, it } from 'vitest'
import {
  CONFIGURATION_REASONS,
  NOT_REACHED_ORDER,
  SIDE_REASONS,
  UNRECORDED_REACH,
  chainStep,
  classifyDifference,
  classifyLink,
  identityChange,
  ignoredParametersOf,
  reachChanges,
  type DifferenceInput,
  type LinkClass,
  type SourceCounterpart,
} from './comparison-reasons'

const page: SourceCounterpart = {
  state: 'done',
  kind: 'page',
  statusCode: 200,
  notRequested: null,
  servedTruncated: false,
  renderState: 'complete',
  captureProvesAbsence: false,
}
const link = (
  counterpart: Partial<SourceCounterpart> | null,
  options: { rendered?: boolean; kind?: string; otherRendered?: boolean } = {},
) =>
  classifyLink({
    rendered: options.rendered ?? false,
    kind: options.kind ?? 'anchor',
    otherRendered: options.otherRendered ?? true,
    counterpart: counterpart && { ...page, ...counterpart },
  })

describe('classifyLink', () => {
  it.each([
    ['a page answered 200', {}, 'whole'],
    ['no counterpart', null, 'not-seen'],
    ['left out by paths', { state: 'skipped', notRequested: 'excluded' }, 'excluded'],
    ['beyond depth', { state: 'skipped', notRequested: 'depth' }, 'depth'],
    ['left for later', { state: 'queued' }, 'not-requested'],
    ['skipped for no recorded reason', { state: 'skipped' }, 'not-requested'],
    ['no answer', { statusCode: null }, 'failed'],
    ['a 500', { statusCode: 500 }, 'failed'],
    ['a 503', { statusCode: 503 }, 'failed'],
    ['a 401', { statusCode: 401 }, 'failed'],
    ['a 403', { statusCode: 403 }, 'failed'],
    ['a 408', { statusCode: 408 }, 'failed'],
    ['a 429', { statusCode: 429 }, 'failed'],
    ['a 404', { statusCode: 404 }, 'whole'],
    ['a 410', { statusCode: 410 }, 'whole'],
    ['a redirect', { statusCode: 301, kind: 'redirect' }, 'redirected'],
    ['a cut body', { servedTruncated: true }, 'served-truncated'],
  ] as const)('a served link from a source that is %s', (_name, counterpart, expected) => {
    expect(link(counterpart as Partial<SourceCounterpart> | null)).toBe(expected)
  })

  it('takes a redirect as whole for the redirect link itself', () => {
    expect(link({ statusCode: 302, kind: 'redirect' }, { kind: 'redirect' })).toBe('whole')
  })

  it('needs a whole served body before anything about the render', () => {
    expect(link({ servedTruncated: true, renderState: 'failed' }, { rendered: true })).toBe(
      'served-truncated',
    )
  })

  it.each([
    [null, false, 'render-missing'],
    ['failed', false, 'render-failed'],
    ['truncated', false, 'render-truncated'],
    ['unsettled', false, 'render-unsettled'],
    ['redirect', false, 'render-redirected'],
    ['unknown', false, 'render-unreliable'],
    ['complete', false, 'render-unreliable'],
    ['complete', true, 'whole'],
    ['unsettled', true, 'render-unsettled'],
  ] as const)(
    'a link found only after rendering, the other render %s (proves absence: %s)',
    (renderState, captureProvesAbsence, expected) => {
      expect(link({ renderState, captureProvesAbsence }, { rendered: true })).toBe(expected)
    },
  )

  it('calls a rendered link from an unrendered crawl a difference of mode, before anything else', () => {
    expect(link(null, { rendered: true, otherRendered: false })).toBe('mode')
    expect(link({ statusCode: 503 }, { rendered: true, otherRendered: false })).toBe('mode')
    expect(link({ statusCode: 503 }, { rendered: false, otherRendered: false })).toBe('failed')
  })

  it('reads a rendered link from a source that now answers 404 as observed', () => {
    expect(link({ statusCode: 404, renderState: null }, { rendered: true })).toBe('whole')
  })
})

const input = (
  classes: Partial<Record<LinkClass, number>>,
  overrides: Partial<DifferenceInput> = {},
): DifferenceInput => ({
  side: 'base',
  source: 'link',
  classes: Object.fromEntries(
    Object.entries(classes).map(([name, via]) => [name, { count: 1, via }]),
  ),
  otherIncomplete: false,
  reach: UNRECORDED_REACH,
  varied: null,
  numbered: true,
  ...overrides,
})
const decide = (...args: Parameters<typeof input>) => {
  const { reason, detail, via } = classifyDifference(input(...args))
  return [reason, detail, via]
}

describe('classifyDifference', () => {
  it('claims a change of the site only when every in-link is whole', () => {
    expect(decide({ whole: 3 })).toEqual(['unlinked', null, 3])
    expect(decide({ whole: 3 }, { side: 'target' })).toEqual(['linked', null, 3])
    expect(decide({ whole: 3, failed: 9 })).toEqual(['notReached', 'failed', 9])
  })

  it('names as "not reached" the first class in the documented order, then the lowest seq', () => {
    const all = Object.fromEntries(NOT_REACHED_ORDER.map((name, i) => [name, 100 - i]))
    expect(decide(all)).toEqual(['notReached', NOT_REACHED_ORDER[0], 100])
    expect(decide({ 'render-unsettled': 4, 'render-truncated': 8 })).toEqual([
      'notReached',
      'render-truncated',
      8,
    ])
  })

  it('leaves a chain pending: only whole sources and sources not seen either', () => {
    expect(decide({ whole: 2, 'not-seen': 5 })[0]).toBe('pending')
    expect(decide({ 'not-seen': 5 })[0]).toBe('pending')
  })

  it('puts settings first only when every blocking link is one', () => {
    expect(decide({ mode: 4, whole: 1 })).toEqual(['mode', null, 4])
    expect(decide({ excluded: 4, 'not-seen': 1 })).toEqual(['settings', 'excluded', 4])
    expect(decide({ excluded: 4, mode: 2 })).toEqual(['settings', 'excluded', 4])
    expect(decide({ excluded: 4, failed: 2 })).toEqual(['notReached', 'failed', 2])
  })

  it('treats depth as a setting only when it is recorded as changed', () => {
    expect(decide({ depth: 7 })).toEqual(['depth', 'unrecorded', 7])
    expect(decide({ depth: 7 }, { reach: { maxDepth: false, maxUrls: false } })).toEqual([
      'depth',
      'unchanged',
      7,
    ])
    expect(decide({ depth: 7 }, { reach: { maxDepth: true, maxUrls: null } })).toEqual([
      'settings',
      'depth',
      7,
    ])
  })

  it('says limit over anything a page linked, configuration when the limit changed', () => {
    expect(decide({ whole: 1 }, { otherIncomplete: true })).toEqual(['limit', 'unrecorded', null])
    expect(
      decide({ whole: 1 }, { otherIncomplete: true, reach: { maxDepth: null, maxUrls: false } }),
    ).toEqual(['limit', null, null])
    expect(
      decide({ whole: 1 }, { otherIncomplete: true, reach: { maxDepth: null, maxUrls: true } }),
    ).toEqual(['settings', 'limit', null])
  })

  it('puts a witnessed variation below the limit and above a change of the site', () => {
    expect(decide({ whole: 1 }, { varied: 1 })).toEqual(['unstable', null, 1])
    expect(decide({ whole: 1 }, { varied: 1, otherIncomplete: true })[0]).toBe('limit')
  })

  it('explains a URL with no in-links only from the setting that put it there, else unknown', () => {
    expect(decide({}, { source: 'priority' })).toEqual(['settings', 'priority', null])
    expect(decide({}, { source: 'security' })).toEqual(['settings', 'files', null])
    expect(decide({}, { source: 'seed' })).toEqual(['unknown', 'no-links', null])
    expect(decide({}, { source: 'sitemap-file' })).toEqual(['unknown', 'no-links', null])
    expect(decide({ whole: 1 }, { numbered: false })).toEqual(['unknown', 'legacy', null])
  })

  it('counts every in-link', () => {
    expect(
      classifyDifference(
        input({}, { classes: { whole: { count: 3, via: 1 }, 'not-seen': { count: 2, via: 4 } } }),
      ).sources,
    ).toBe(5)
  })
})

describe('chainStep', () => {
  it('is not reached through any source with another reason, the lowest first', () => {
    expect(
      chainStep('base', [
        { reason: 'unlinked', seq: 1 },
        { reason: 'notReached', seq: 9 },
        { reason: 'merged', seq: 4 },
      ]),
    ).toEqual({ reason: 'notReached', through: 4 })
  })
  it('stays pending through changes of the site and other pending URLs', () => {
    expect(
      chainStep('target', [
        { reason: 'linked', seq: 1 },
        { reason: 'pending', seq: 2 },
      ]),
    ).toEqual({ reason: 'pending', through: null })
    // `unlinked` is the other side's change: on the target side it is not one.
    expect(chainStep('target', [{ reason: 'unlinked', seq: 1 }]).reason).toBe('notReached')
  })
  it('is unknown through a source that was never explained', () => {
    expect(chainStep('base', [{ reason: null, seq: 1 }])).toEqual({
      reason: 'unknown',
      through: null,
    })
  })
})

describe('identityChange', () => {
  it.each([
    ['https://a.com/e?duration=60', ['duration'], 'https://a.com/e'],
    ['https://a.com/e?x=1&duration=60', ['duration'], 'https://a.com/e?x=1'],
    ['https://a.com/e?utm_source=a&utm_medium=b', ['utm_*'], 'https://a.com/e'],
    ['https://a.com/e?dur%61tion=60', ['duration'], 'https://a.com/e'],
    ['https://a.com/e?x=1', ['duration'], null],
    ['https://a.com/e', ['duration'], null],
    ['https://a.com/e?duration=1', [], null],
  ])('%s ignoring %j', (url, patterns, expected) => {
    expect(identityChange(url, patterns)).toBe(expected)
  })

  it('names the parameters it strips', () => {
    expect(ignoredParametersOf('https://a.com/e?utm_a=1&x=2&utm_b=3', ['utm_*'])).toEqual([
      'utm_a',
      'utm_b',
    ])
    expect(ignoredParametersOf('https://a.com/e', ['utm_*'])).toEqual([])
  })
})

describe('the groups', () => {
  it('keeps every configuration reason out of "not seen" and "discovered" on both sides', () => {
    for (const reason of CONFIGURATION_REASONS) {
      expect(
        SIDE_REASONS.base.includes(reason as never) ||
          SIDE_REASONS.target.includes(reason as never),
      ).toBe(true)
    }
  })
})

describe('reachChanges', () => {
  it('reads changed, unrecorded and unchanged reach settings from the discovery comparison', () => {
    expect(reachChanges([])).toEqual({ maxDepth: false, maxUrls: false })
    expect(
      reachChanges([
        { setting: 'maxDepth', status: 'different' },
        { setting: 'maxUrls', status: 'unknown' },
        { setting: 'userAgent', status: 'different' },
      ]),
    ).toEqual({ maxDepth: true, maxUrls: null })
  })
})
