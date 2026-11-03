import { ISSUE_EVIDENCE } from '@seotools/core/crawl/evidence'
import { describe, expect, it } from 'vitest'
import en from '../messages/en.json'
import es from '../messages/es.json'

describe.each(Object.entries({ en, es }))(
  '%s messages of the evidence of findings',
  (_, catalog) => {
    const messages = catalog.IssueEvidence

    it('labels every issue that comes with evidence', () => {
      const labels = messages.labels as Record<string, string>
      const missing = Object.keys(ISSUE_EVIDENCE).filter((issue) => !labels[issue])
      expect(missing).toEqual([])
    })

    it('does not label an issue that has none', () => {
      expect(Object.keys(messages.labels).filter((issue) => !(issue in ISSUE_EVIDENCE))).toEqual([])
    })

    it('names the unit of every kind of evidence', () => {
      const kinds = new Set<string>(Object.values(ISSUE_EVIDENCE))
      expect(Object.keys(messages.units).sort()).toEqual([...kinds].sort())
    })
  },
)
