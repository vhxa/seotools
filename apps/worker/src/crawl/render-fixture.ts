import type { RenderInput, RenderOutcome } from '../render/types'

/** A deterministic rendering double; the Chromium suite tests execution of the menu script. */
export function renderedOutcome(input: RenderInput, extra = ''): RenderOutcome {
  return {
    status: 'rendered',
    settled: true,
    finalUrl: input.url,
    html: (input.document.body?.toString() ?? '') + extra,
    truncated: false,
    durationMs: 1,
    requests: {
      made: 0,
      cached: 0,
      failedCount: 0,
      omittedCount: 0,
      blockedByRobotsCount: 0,
      refusedCount: 0,
      failed: [],
      omitted: [],
      blockedByRobots: [],
      refused: [],
    },
    scriptErrors: { count: 0, first: [] },
  }
}
