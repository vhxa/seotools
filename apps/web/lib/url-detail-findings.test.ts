import { describe, expect, it } from 'vitest'
import { groupDetailFindings } from './url-detail-findings'

describe('URL detail findings', () => {
  it('surfaces high importance warnings alongside high importance issues before lower findings', () => {
    const findings = [
      { issue: 'redirect-3xx' },
      { issue: 'soft-404-possible' },
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
