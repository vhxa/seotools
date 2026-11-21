import { describe, expect, it } from 'vitest'
import { captureProvesAbsence, CURRENT_CAPTURE_RULE, RENDER_STATES } from './render-state'

const data = {
  capture: { rule: CURRENT_CAPTURE_RULE, afterMs: 5005, pending: 0, delayMs: 5 },
  requests: { failedCount: 0, refusedCount: 1, omittedCount: 1 },
}

describe('absence of a rendered link', () => {
  it.each(RENDER_STATES)('requires a complete capture (%s)', (state) => {
    expect(captureProvesAbsence({ state, data })).toBe(state === 'complete')
  })

  it.each([
    null,
    {},
    { ...data, capture: { ...data.capture, rule: 'v3' } },
    { ...data, capture: { ...data.capture, pending: 1 } },
    { ...data, capture: { ...data.capture, afterMs: null } },
    { ...data, capture: { ...data.capture, delayMs: null } },
    { ...data, capture: { ...data.capture, delayMs: 100 } },
    { ...data, requests: undefined },
    { ...data, requests: { failedCount: 1 } },
  ])('leaves missing or unreliable evidence unverified (%j)', (incomplete) => {
    expect(captureProvesAbsence({ state: 'complete', data: incomplete })).toBe(false)
  })
})
