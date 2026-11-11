import { expect, it } from 'vitest'
import { emptyVitals } from '@seotools/core'
import { urlVitals, vitalsPoints } from './vitals'
const row = {
  ...emptyVitals(),
  crawlId: 'a',
  formFactor: 'PHONE',
  status: 'collected',
  error: null,
  collectedAt: new Date(),
  lcp: 2500,
}
it('keeps field and lab separate and never fills absent field values from lab', () => {
  expect(urlVitals([{ ...row, urlHash: 'x', source: 'lab' }], 'x').field).toBeUndefined()
  expect(urlVitals([{ ...row, urlHash: 'x', source: 'field' }], 'y').field).toBeUndefined()
})
it('keeps gaps in the trend and sorts by crawl time', () => {
  expect(
    vitalsPoints([
      { crawl: { createdAt: new Date(2), finishedAt: null }, rows: [] },
      { crawl: { createdAt: new Date(1), finishedAt: null }, rows: [row] },
    ]),
  ).toEqual([
    { at: 1, lcp: 2500, inp: null, cls: null },
    { at: 2, lcp: null, inp: null, cls: null },
  ])
})
