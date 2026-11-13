import type { RenderInput, RenderOutcome } from '../render/types'
import { renderedOutcome } from './render-fixture'
import { page, words, type PageOptions } from './test-site'

interface DifferenceFixture {
  before?: PageOptions
  after?: PageOptions
  withoutStructuredData?: boolean
  outcome?: (outcome: RenderOutcome) => RenderOutcome
}

/** Each difference has its own document so that the real browser suite can prove all of them. */
export const DIFFERENCE_FIXTURES = {
  'text-only-after-rendering': {
    before: { text: words('short', 20) },
    after: { text: words('long', 300) },
  },
  'title-only-after-rendering': { before: { title: null } },
  'title-changed-by-javascript': {
    after: { title: 'A different title after JavaScript executes' },
  },
  'description-only-after-rendering': { before: { description: null } },
  'description-changed-by-javascript': {
    after: { description: 'A different description after JavaScript executes' },
  },
  'h1-only-after-rendering': { before: { h1: null } },
  'h1-changed-by-javascript': { after: { h1: 'A different heading' } },
  'canonical-only-after-rendering': { before: { canonical: null } },
  'canonical-changed-by-javascript': { after: { canonical: 'https://example.com/target' } },
  'noindex-only-in-html': { before: { head: '<meta name="robots" content="noindex">' } },
  'noindex-added-by-javascript': { after: { head: '<meta name="robots" content="noindex">' } },
  'nofollow-only-in-html': { before: { head: '<meta name="robots" content="nofollow">' } },
  'nofollow-added-by-javascript': { after: { head: '<meta name="robots" content="nofollow">' } },
  'structured-data-only-after-rendering': { withoutStructuredData: true },
  'hreflang-only-after-rendering': {
    after: { head: '<link rel="alternate" hreflang="en" href="https://example.com/x">' },
  },
  'social-tags-only-after-rendering': { before: { social: null } },
  'javascript-redirect': {
    outcome: (outcome) => ({ ...outcome, finalUrl: 'https://example.com/target' }),
  },
  'render-resources-blocked-by-robots': {
    outcome: (outcome) => ({
      ...outcome,
      requests: {
        ...outcome.requests,
        blockedByRobotsCount: 1,
        blockedByRobots: ['https://example.com/blocked.js'],
      },
    }),
  },
  'render-failed': {
    outcome: (outcome) => ({
      ...outcome,
      status: 'failed',
      failure: { code: 'serialization', message: 'failed' },
    }),
  },
  'render-script-errors': {
    outcome: (outcome) => ({ ...outcome, scriptErrors: { count: 1, first: ['Uncaught error'] } }),
  },
} satisfies Record<string, DifferenceFixture>

export type DifferenceId = keyof typeof DIFFERENCE_FIXTURES
export function differenceDocuments(id: DifferenceId, path = '/x') {
  const fixture: DifferenceFixture = DIFFERENCE_FIXTURES[id]
  let before = page(path, fixture.before).body!.toString()
  if (fixture.withoutStructuredData)
    before = before.replace(/<script type="application\/ld\+json">.*?<\/script>/, '')
  return { before, after: page(path, fixture.after).body!.toString() }
}
export function differenceOutcome(id: DifferenceId, input: RenderInput) {
  const outcome = renderedOutcome(input)
  outcome.html = differenceDocuments(id).after
  const fixture: DifferenceFixture = DIFFERENCE_FIXTURES[id]
  return fixture.outcome?.(outcome) ?? outcome
}
