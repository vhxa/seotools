import type { Crawl } from '@seotools/db'
import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'
import en from '../messages/en.json'
import es from '../messages/es.json'
import { coverageGapOf, renderCoverageOf } from './rendering'

const rendered = { mode: 'rendered' } as Crawl['rendering']
const observation = {
  unobserved: 1200,
  causes: { failedOrMissing: 1, truncated: 2, unsettled: 1197 },
}

describe('renderCoverageOf', () => {
  it('reads what the analysis recorded of a rendered crawl', () => {
    expect(renderCoverageOf({ rendering: rendered, renderObservation: observation })).toEqual(
      observation,
    )
  })

  it('knows nothing of a crawl that was not rendered or whose analysis recorded nothing', () => {
    expect(renderCoverageOf({ rendering: null, renderObservation: observation })).toBeNull()
    expect(renderCoverageOf({ rendering: rendered, renderObservation: null })).toBeNull()
  })

  it('tells a crawl never analysed from one whose analysis left the coverage out', () => {
    expect(coverageGapOf({ auditVersion: null })).toBe('not-analysed')
    expect(coverageGapOf({ auditVersion: 0 })).toBe('not-recorded')
    expect(coverageGapOf({ auditVersion: 4 })).toBe('not-recorded')
  })
})

describe('counts of pages above a thousand', () => {
  // A formatted string such as "2,033" is not a number for an ICU plural: it printed "NaN".
  it.each([
    ['en', en],
    ['es', es],
  ] as const)('%s prints the number a plural is given', (locale, messages) => {
    const t = createTranslator({ locale, messages, namespace: 'RenderingSummary' })
    const grouped = locale === 'en' ? '2,033' : '2033'
    expect(t('rendered', { count: 2033 })).toContain(grouped)
    expect(t('someUnobserved', { count: 1200 })).not.toContain('NaN')
    expect(t('stamp.someUnobserved', { count: 1200 })).not.toContain('NaN')
    expect(t('rendered', { count: 2033 })).not.toContain('NaN')
  })
})

describe('rendering coverage explanations', () => {
  it.each([
    ['en', en, /not compared between crawls/, /compare pages with each other/],
    ['es', es, /no se comparan entre rastreos/, /comparan unas páginas con otras/],
  ] as const)(
    '%s explains loading absences and distinguishes legacy unsettled counts',
    (locale, messages, comparison, documents) => {
      const t = createTranslator({ locale, messages, namespace: 'RenderingSummary' })
      const loading = t('loading', { count: 2 })
      expect(loading).toMatch(comparison)
      expect(loading).toMatch(documents)
      for (const key of ['causes', 'stamp.causes'] as const) {
        const text = t(key, { failed: 0, truncated: 0, legacyUnsettled: 2033 })
        expect(text).toContain('2033')
      }
    },
  )
})
