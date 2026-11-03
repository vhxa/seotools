import { crawlUrlHash, type IssueEvidence } from '@seotools/core'
import { describe, expect, it, vi } from 'vitest'
import { crawlUrlsInEvidence, evidenceAddresses, evidenceTarget } from './issue-evidence'

const images: IssueEvidence = {
  kind: 'images',
  total: 3,
  items: [
    { src: '/a.png', url: 'https://acme.com/a.png' },
    { src: '/a.png', url: 'https://acme.com/a.png' },
    { src: 'data:image/png;base64,…', url: null },
    { src: 'javascript:alert(1)', url: 'javascript:alert(1)' },
  ],
}
const related: IssueEvidence = {
  kind: 'related-urls',
  total: 2,
  urls: ['https://acme.com/b', 'https://acme.com/c'],
}
const links: IssueEvidence = {
  kind: 'links',
  total: 2,
  items: [
    { kind: 'anchor', url: 'https://acme.com/b' },
    { kind: 'anchor', url: 'http://localhost:3000/dev' },
    { kind: 'anchor', url: null, raw: 'javascript:go()' },
  ],
}

describe('the addresses in the evidence of findings', () => {
  it('are each listed once, without those that cannot be requested', () => {
    expect(evidenceAddresses([{ evidence: images }, { evidence: links }, {}])).toEqual([
      'https://acme.com/a.png',
      'https://acme.com/b',
      'http://localhost:3000/dev',
    ])
  })

  it('leave out the other pages of a duplicate, which are in the crawl already', () => {
    expect(evidenceAddresses([{ evidence: related }])).toEqual([])
  })
})

describe('which addresses of evidence the crawl has a page for', () => {
  it('asks only about those that are not in the crawl by construction', async () => {
    const has = vi.fn(async (url: string) => url === 'https://acme.com/a.png')
    const known = await crawlUrlsInEvidence(
      [{ evidence: related }, { evidence: images }, { evidence: links }],
      has,
    )
    expect(known).toEqual(
      new Set(['https://acme.com/b', 'https://acme.com/c', 'https://acme.com/a.png']),
    )
    // /b is a related page of another finding, so it was not asked about again.
    expect(has.mock.calls.map(([url]) => url).sort()).toEqual([
      'http://localhost:3000/dev',
      'https://acme.com/a.png',
    ])
  })

  it('does not look up more than it is allowed to', async () => {
    const many: IssueEvidence = {
      kind: 'links',
      total: 500,
      items: Array.from({ length: 10 }, (_, i) => ({
        kind: 'anchor' as const,
        url: `https://acme.com/${i}`,
      })),
    }
    const has = vi.fn(async () => true)
    const known = await crawlUrlsInEvidence([{ evidence: many }, { evidence: many }], has, 4)
    expect(has).toHaveBeenCalledTimes(4)
    expect(known.size).toBe(4)
  })
})

describe('how an address in evidence is shown', () => {
  const known = new Set(['https://acme.com/b'])

  it('links to the detail of a page the crawl has', () => {
    expect(evidenceTarget('https://acme.com/b', known)).toEqual({
      kind: 'crawl',
      hash: crawlUrlHash('https://acme.com/b'),
      url: 'https://acme.com/b',
    })
  })

  it('links to any other HTTP address, as it is', () => {
    expect(evidenceTarget('https://elsewhere.org/x', known)).toEqual({
      kind: 'external',
      url: 'https://elsewhere.org/x',
    })
  })

  it.each([
    null,
    '',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://acme.com/file',
    'https://user:secret@acme.com/',
    '//cdn.acme.com/x.png',
    'not a url',
  ])('shows %j as text, never as a link', (value) => {
    expect(evidenceTarget(value, known)).toEqual({ kind: 'text' })
  })
})
