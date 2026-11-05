import { PAGE_ISSUES } from '@seotools/core/crawl/issues'
import { describe, expect, it } from 'vitest'
import en from '../messages/en.json'
import es from '../messages/es.json'

describe.each(Object.entries({ en, es }))('%s finding guidance', (_, catalog) => {
  it('offers a next step for every catalog finding, through specific or subject guidance', () => {
    const guidance: Record<string, string> = catalog.FindingHelp
    const missing = Object.entries(PAGE_ISSUES)
      .filter(([issue, { category }]) => !guidance[issue]?.trim() && !guidance[category]?.trim())
      .map(([issue]) => issue)
    expect(missing).toEqual([])
  })
})
