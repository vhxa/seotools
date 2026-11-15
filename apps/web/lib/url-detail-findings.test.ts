import { describe, expect, it } from 'vitest'
import { documentFindingsState, groupDetailFindings } from './url-detail-findings'

describe('URL detail findings', () => {
  it('surfaces high importance warnings alongside high importance issues before lower findings', () => {
    const findings = [
      { issue: 'redirect-3xx' },
      { issue: 'soft-404-confirmed' },
      { issue: 'no-response' },
      { issue: 'redirect-chain' },
    ]
    expect(groupDetailFindings(findings)).toEqual([
      { importance: 'high', findings: [findings[1], findings[2]] },
      { importance: 'medium', findings: [findings[3]] },
      { importance: 'low', findings: [findings[0]] },
    ])
    expect(findings[0]?.issue).toBe('redirect-3xx')
  })

  it('keeps unknown historical findings and their evidence without inventing importance', () => {
    const finding = { issue: 'retired-check', evidence: { total: 2 } }
    const groups = groupDetailFindings([finding])
    expect(groups).toEqual([{ importance: 'unknown', findings: [finding] }])
    expect(groups[0]?.findings[0]).toBe(finding)
  })

  it('does not invent findings or empty groups for an empty audit', () => {
    expect(groupDetailFindings([])).toEqual([])
  })
})

describe('the stored document observation label', () => {
  it('keeps legacy served analyses labelled HTML even when a render exists', () => {
    expect(
      documentFindingsState({
        page: true,
        render: { status: 'rendered', settled: true, truncated: false, data: {} },
      }),
    ).toMatchObject({ rendered: false, unknown: false })
  })
  it('shows unknown rather than no findings for incomplete documents and reports redirect separately', () => {
    expect(
      documentFindingsState({
        page: true,
        documentBasis: 'rendered-v1',
        observation: 'unobserved',
        unobserved: ['title-missing'],
        render: { status: 'failed', settled: false, truncated: false, data: {} },
      }),
    ).toMatchObject({ rendered: true, unknown: true, reason: 'failed', count: 1 })
    expect(
      documentFindingsState({
        page: true,
        documentBasis: 'rendered-v1',
        observation: 'redirected',
        render: {
          status: 'rendered',
          settled: false,
          truncated: false,
          data: { redirected: true },
        },
      }),
    ).toMatchObject({ unknown: true, reason: 'redirected' })
  })
  it('leaves complete URLs locally observed while identifying unknown site-dependent checks', () => {
    expect(
      documentFindingsState({ page: true, documentBasis: 'rendered-v1', observation: 'complete' }),
    ).toMatchObject({ unknown: false, count: 0 })
    expect(
      documentFindingsState({
        page: true,
        documentBasis: 'rendered-v1',
        observation: 'complete',
        crawlUnobserved: ['title-duplicate', 'render-script-errors'],
      }),
    ).toMatchObject({ unknown: true, reason: 'dependencies', count: 1 })
  })
})
