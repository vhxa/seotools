import { describe, expect, it } from 'vitest'
import {
  CONFIGURATION_REASONS,
  NOT_REACHED_ORDER,
  SIDE_REASONS,
  chainStep,
  classifyDifference,
  classifyLink,
  entersChain,
  identityChange,
  ignoredParametersOf,
  narrower,
  type ClassTally,
  type DifferenceInput,
  type LinkClass,
  type LinkObservation,
  type PageObservation,
  type PairConditions,
} from './comparison-reasons'

const page: PageObservation = {
  state: 'done',
  kind: 'page',
  statusCode: 200,
  notRequested: null,
  servedTruncated: false,
  renderState: 'complete',
  renderTrusted: true,
}
const comparable: PairConditions = {
  otherRendered: true,
  requestsComparable: true,
  rendersComparable: true,
  depthNarrowed: false,
}
const link = (
  other: Partial<PageObservation> | null,
  options: Partial<Omit<LinkObservation, 'other' | 'own' | 'conditions'>> & {
    own?: Partial<PageObservation>
    conditions?: Partial<PairConditions>
  } = {},
) =>
  classifyLink({
    rendered: options.rendered ?? false,
    kind: options.kind ?? 'anchor',
    own: { ...page, ...options.own },
    other: other && { ...page, ...other },
    identityChanged: options.identityChanged ?? false,
    conditions: { ...comparable, ...options.conditions },
  })

describe('classifyLink', () => {
  it('calls a link gone only when both crawls read its source the same way, whole', () => {
    expect(link({})).toBe('whole')
    expect(link({}, { rendered: true })).toBe('whole')
  })

  // Finding 1: an error page's HTML (or any answer that is not the page) never proves a link.
  it.each([
    ['503', { statusCode: 503 }],
    ['404', { statusCode: 404 }],
    ['301', { statusCode: 301, kind: 'redirect' as const }],
    ['no answer', { statusCode: null }],
    ['a cut body', { servedTruncated: true }],
    ['not requested', { state: 'queued' as const }],
  ])('never reads a link from a source that answered %s in the crawl that has it', (_n, own) => {
    expect(link({}, { own })).toBe('source-unobserved')
  })

  it.each([
    ['no counterpart', null, 'not-seen'],
    ['left out by paths', { state: 'skipped', notRequested: 'excluded' }, 'excluded'],
    ['left for later', { state: 'queued' }, 'not-requested'],
    ['no answer', { statusCode: null }, 'failed'],
    ['a 503', { statusCode: 503 }, 'failed'],
    ['a 401', { statusCode: 401 }, 'failed'],
    ['a 403', { statusCode: 403 }, 'failed'],
    ['a 429', { statusCode: 429 }, 'failed'],
    ['a 404', { statusCode: 404 }, 'error-answer'],
    ['a 410', { statusCode: 410 }, 'error-answer'],
    ['a 206', { statusCode: 206 }, 'error-answer'],
    ['a redirect', { statusCode: 301, kind: 'redirect' }, 'redirected'],
    ['a cut body', { servedTruncated: true }, 'served-truncated'],
  ] as const)('reads a source that is %s in the other crawl', (_n, other, expected) => {
    expect(link(other as Partial<PageObservation> | null)).toBe(expected)
  })

  it('observes a redirect link only through a redirect on both sides', () => {
    const redirect = { statusCode: 302, kind: 'redirect' as const }
    expect(link(redirect, { kind: 'redirect', own: redirect })).toBe('whole')
    expect(link({}, { kind: 'redirect', own: redirect })).toBe('other-answer')
  })

  // Finding 3: the same page means the same address.
  it('never compares a source the other crawl reads at another address', () => {
    expect(link({}, { identityChanged: true })).toBe('identity')
  })

  it('needs recorded, equal request settings to call a link gone', () => {
    expect(link({}, { conditions: { requestsComparable: false } })).toBe('settings')
  })

  it('reads a source beyond the depth as a setting only when the other depth is narrower', () => {
    const deep = { state: 'skipped' as const, notRequested: 'depth' as const }
    expect(link(deep, { conditions: { depthNarrowed: true } })).toBe('depth-setting')
    expect(link(deep, { conditions: { depthNarrowed: false } })).toBe('depth')
    expect(link(deep, { conditions: { depthNarrowed: null } })).toBe('depth')
  })

  describe('a link found only after rendering', () => {
    it.each([
      [null, 'render-missing'],
      ['failed', 'render-failed'],
      ['truncated', 'render-truncated'],
      ['unsettled', 'render-unsettled'],
      ['redirect', 'render-redirected'],
      ['unknown', 'render-unreliable'],
    ] as const)('the other render is %s', (renderState, expected) => {
      expect(link({ renderState }, { rendered: true })).toBe(expected)
    })

    it('needs a trusted capture on both sides (finding 1)', () => {
      expect(link({ renderTrusted: false }, { rendered: true })).toBe('render-unreliable')
      expect(link({}, { rendered: true, own: { renderTrusted: false } })).toBe('render-own')
    })

    // Finding 3: renders with another configured wait are not compared.
    it('needs the same rendering settings on both sides', () => {
      expect(link({}, { rendered: true, conditions: { rendersComparable: false } })).toBe(
        'render-settings',
      )
    })

    // Finding 5: a failed linker is not reached before it is anything a setting explains.
    it('is a difference of mode only once the source answered whole', () => {
      expect(link({}, { rendered: true, conditions: { otherRendered: false } })).toBe('mode')
      expect(
        link({ statusCode: 403 }, { rendered: true, conditions: { otherRendered: false } }),
      ).toBe('failed')
      expect(
        link(
          {},
          { rendered: true, own: { statusCode: 403 }, conditions: { otherRendered: false } },
        ),
      ).toBe('source-unobserved')
    })
  })
})

const tally = (via: number, count = 1): ClassTally => ({
  count,
  via,
  kind: 'anchor',
  rendered: false,
})
const input = (
  classes: Partial<Record<LinkClass, number>>,
  overrides: Partial<DifferenceInput> = {},
): DifferenceInput => ({
  side: 'base',
  source: 'link',
  classes: Object.fromEntries(Object.entries(classes).map(([name, via]) => [name, tally(via)])),
  otherIncomplete: false,
  limitNarrowed: false,
  depthNarrowed: false,
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
  })

  it('names the edge it is about', () => {
    expect(
      classifyDifference(
        input({}, { classes: { whole: { count: 2, via: 4, kind: 'canonical', rendered: true } } }),
      ),
    ).toMatchObject({ via: 4, viaKind: 'canonical', viaRendered: true })
  })

  it('says not reached before anything else, in the documented order', () => {
    const all = Object.fromEntries(NOT_REACHED_ORDER.map((name, i) => [name, 100 - i]))
    expect(decide({ ...all, mode: 1, whole: 2 })).toEqual(['notReached', NOT_REACHED_ORDER[0], 100])
    // Finding 5: a failed linker wins over a difference of mode or paths.
    expect(decide({ mode: 1, failed: 9 })).toEqual(['notReached', 'failed', 9])
    expect(decide({ excluded: 1, failed: 9 }, { otherIncomplete: true })).toEqual([
      'notReached',
      'failed',
      9,
    ])
  })

  it('is unknown when an observation cannot decide, never a change of the site', () => {
    for (const name of [
      'source-unobserved',
      'identity',
      'render-own',
      'render-settings',
      'settings',
    ] as const)
      expect(decide({ whole: 1, [name]: 2 })[0], name).toBe('unknown')
  })

  // Finding 5: a setting takes a URL out of the counts only when it explains every way in.
  it('puts a URL in the configuration group only when every link is explained by a setting', () => {
    expect(decide({ mode: 4 })).toEqual(['mode', null, 4])
    expect(decide({ excluded: 4, mode: 2 })).toEqual(['settings', 'excluded', 4])
    expect(decide({ 'depth-setting': 4 })).toEqual(['settings', 'depth', 4])
    expect(decide({ mode: 4, whole: 1 })).toEqual(['unknown', 'partial-configuration', null])
    expect(decide({ excluded: 4, 'not-seen': 1 })).toEqual([
      'unknown',
      'partial-configuration',
      null,
    ])
  })

  it('says beyond the depth when it is not a narrower setting', () => {
    expect(decide({ depth: 7 })).toEqual(['depth', 'unchanged', 7])
    expect(decide({ depth: 7 }, { depthNarrowed: null })).toEqual(['depth', 'unrecorded', 7])
  })

  // Finding 5: a raised limit cannot explain a URL the later crawl lacks.
  it('says limit, and configuration only when the other limit is narrower', () => {
    expect(decide({ whole: 1 }, { otherIncomplete: true })).toEqual(['limit', null, null])
    expect(decide({ whole: 1 }, { otherIncomplete: true, limitNarrowed: null })).toEqual([
      'limit',
      'unrecorded',
      null,
    ])
    expect(decide({ whole: 1 }, { otherIncomplete: true, limitNarrowed: true })).toEqual([
      'settings',
      'limit',
      null,
    ])
  })

  it('puts a witnessed variation below not reached and the limit', () => {
    expect(decide({ whole: 1 }, { varied: 1 })).toEqual(['unstable', null, 1])
    expect(decide({ whole: 1 }, { varied: 1, otherIncomplete: true })[0]).toBe('limit')
  })

  it('leaves a chain pending, with its entrance when it has one', () => {
    expect(decide({ whole: 2, 'not-seen': 5 })).toEqual(['pending', null, 2])
    expect(decide({ 'not-seen': 5 })).toEqual(['pending', null, null])
  })

  it('explains a URL with no in-links only from the setting that put it there, else unknown', () => {
    expect(decide({}, { source: 'priority' })).toEqual(['settings', 'priority', null])
    expect(decide({}, { source: 'security' })).toEqual(['settings', 'files', null])
    expect(decide({}, { source: 'seed' })).toEqual(['unknown', 'no-links', null])
    expect(decide({ whole: 1 }, { numbered: false })).toEqual(['unknown', 'legacy', null])
  })
})

describe('narrower', () => {
  it('compares limits in the direction of the difference', () => {
    expect(narrower(1000, 100)).toBe(true)
    expect(narrower(null, 100)).toBe(true)
    expect(narrower(100, 1000)).toBe(false)
    expect(narrower(100, null)).toBe(false)
    expect(narrower(100, 100)).toBe(false)
    expect(narrower(undefined, 100)).toBeNull()
  })
})

// Finding 4: a closed group with no observed entrance is never a change of the site.
describe('entersChain', () => {
  it('needs an observed entrance into the group', () => {
    expect(entersChain('base', true, [])).toBe(true)
    expect(entersChain('base', false, [{ reason: 'pending', entered: false }])).toBe(false)
    expect(entersChain('base', false, [{ reason: 'pending', entered: true }])).toBe(true)
    expect(entersChain('base', false, [{ reason: 'unlinked', entered: false }])).toBe(true)
    expect(entersChain('target', false, [{ reason: 'unlinked', entered: false }])).toBe(false)
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
