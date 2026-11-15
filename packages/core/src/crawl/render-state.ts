/**
 * What a rendered crawl observed of one page, in one word. Pure, so the database (which counts and
 * filters in SQL with the same precedence), the worker's coverage figures and the pages that show it
 * (client components included) agree on it.
 *
 * A page is **completely observed** (`complete`, `redirect`) only when its render finished, was not
 * cut at the size limit (nor was the served HTML) and either settled or was explicitly stopped by
 * a main-frame navigation to another address. Everything else says which part is missing and leaves
 * what depends on it unknown, never "no difference".
 *
 * The first matching state wins, in this order:
 * - `failed`: the render did not produce a document.
 * - `truncated`: the rendered document, or the served HTML, was cut at the size limit.
 * - `unknown`: a render stored before truncation was recorded, so whether it was whole is unknown.
 * - `redirect`: JavaScript sent the page to another address; the abandoned document is not compared.
 * - `unsettled`: the page was still loading when the wait limit ended.
 * - `complete`: whole, settled.
 */
export const RENDER_STATES = [
  'complete',
  'redirect',
  'unsettled',
  'truncated',
  'failed',
  'unknown',
] as const
export type RenderState = (typeof RENDER_STATES)[number]

export interface RenderObservation {
  status: 'rendered' | 'failed'
  settled: boolean
  /** `null`: stored before truncation was recorded. */
  truncated: boolean | null
  redirected: boolean
  /** The served HTML was cut at the size limit. */
  servedTruncated: boolean
}

export function renderStateOf(render: RenderObservation): RenderState {
  if (render.status === 'failed') return 'failed'
  if (render.truncated === true || render.servedTruncated) return 'truncated'
  if (render.truncated === null) return 'unknown'
  if (render.redirected) return 'redirect'
  if (!render.settled) return 'unsettled'
  return 'complete'
}

/** Whether the observation is whole: what a JavaScript finding or a missing link may rest on. */
export const isCompleteRender = (state: RenderState) => state === 'complete' || state === 'redirect'

/** The states a page can be in when its render did not give a whole observation. */
export const INCOMPLETE_RENDER_STATES = [
  'unsettled',
  'truncated',
  'failed',
  'unknown',
] as const satisfies readonly RenderState[]

/**
 * What the pages table filters by. `not-rendered` is a page the crawl has no render for (an HTML
 * crawl, an older crawl, a page the browser was never asked about).
 */
export const RENDER_FILTERS = ['complete', 'redirect', 'incomplete', 'not-rendered'] as const
export type RenderFilter = (typeof RENDER_FILTERS)[number]
export const isRenderFilter = (value: unknown): value is RenderFilter =>
  typeof value === 'string' && (RENDER_FILTERS as readonly string[]).includes(value)

/** The render states a filter keeps, or `null` for `not-rendered`: the URLs with no render at all. */
export function renderFilterStates(filter: RenderFilter): readonly RenderState[] | null {
  switch (filter) {
    case 'complete':
      return ['complete']
    case 'redirect':
      return ['redirect']
    case 'incomplete':
      return INCOMPLETE_RENDER_STATES
    case 'not-rendered':
      return null
  }
}

/** How many renders of a crawl are in each state. */
export type RenderCounts = Record<RenderState, number>
export const emptyRenderCounts = (): RenderCounts => ({
  complete: 0,
  redirect: 0,
  unsettled: 0,
  truncated: 0,
  failed: 0,
  unknown: 0,
})
