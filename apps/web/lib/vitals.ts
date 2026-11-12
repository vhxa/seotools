import type { Crawl, UrlVitalsRecord, VitalsRecord } from '@seotools/db'
export function urlVitals(rows: UrlVitalsRecord[], urlHash: string) {
  const matches = rows.filter((row) => row.urlHash === urlHash && row.formFactor === 'PHONE')
  return {
    field: matches.find((row) => row.source === 'field'),
    lab: matches.find((row) => row.source === 'lab'),
  }
}
export interface VitalsPoint {
  at: number
  lcp: number | null
  inp: number | null
  cls: number | null
}
export function vitalsPoints(
  history: { crawl: Pick<Crawl, 'finishedAt' | 'createdAt'>; rows: VitalsRecord[] }[],
): VitalsPoint[] {
  return history
    .map(({ crawl, rows }) => {
      const phone = rows.find((row) => row.formFactor === 'PHONE' && row.status === 'collected')
      return {
        at: (crawl.finishedAt ?? crawl.createdAt).getTime(),
        lcp: phone?.lcp ?? null,
        inp: phone?.inp ?? null,
        cls: phone?.cls ?? null,
      }
    })
    .sort((a, b) => a.at - b.at)
}
