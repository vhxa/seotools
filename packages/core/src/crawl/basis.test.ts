import { expect, it } from 'vitest'
import { ISSUE_BASIS, RENDERED_GRAPH_ISSUES } from './basis'
import { PAGE_ISSUE_IDS } from './issues'

it('classifies every catalog issue explicitly, with the established eleven graph issues', () => {
  expect(Object.keys(ISSUE_BASIS).sort()).toEqual([...PAGE_ISSUE_IDS].sort())
  expect(RENDERED_GRAPH_ISSUES).toHaveLength(11)
  expect(ISSUE_BASIS['og-url-mismatch']).toBe('html')
  expect(ISSUE_BASIS['no-outgoing-links']).toBe('document')
  expect(ISSUE_BASIS['missing-security-header']).toBe('response')
})
