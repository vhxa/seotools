import { describe, expect, it } from 'vitest'
import { ISSUE_EVIDENCE, boundedText, evidenceKindOf, parseIssueEvidence } from './evidence'
import { PAGE_ISSUES } from './issues'
import { MAX_EVIDENCE_ITEMS, MAX_EVIDENCE_TEXT, MAX_EVIDENCE_URL } from './types'

describe('ISSUE_EVIDENCE', () => {
  it('only names issues that exist', () => {
    for (const issue of Object.keys(ISSUE_EVIDENCE)) expect(PAGE_ISSUES).toHaveProperty(issue)
  })

  it('says nothing of an issue that has none, or of what is not an issue', () => {
    expect(evidenceKindOf('img-no-alt')).toBe('images')
    expect(evidenceKindOf('title-too-long')).toBeNull()
    expect(evidenceKindOf('toString')).toBeNull()
    expect(evidenceKindOf('__proto__')).toBeNull()
  })
})

describe('boundedText', () => {
  it('puts text on one line and cuts it where it is too long', () => {
    expect(boundedText('  a \n\t b  ')).toBe('a b')
    const cut = boundedText('x'.repeat(10_000))
    expect(cut).toHaveLength(MAX_EVIDENCE_TEXT)
    expect(cut.endsWith('…')).toBe(true)
  })
})

describe('parseIssueEvidence', () => {
  const images = {
    kind: 'images',
    total: 3,
    items: [{ src: '/a.png', url: 'https://example.com/a.png', id: 'logo' }],
  }

  it('reads what the worker stores, exactly as it was', () => {
    expect(parseIssueEvidence(images)).toEqual(images)
    const links = {
      kind: 'links',
      total: 1,
      items: [{ kind: 'anchor', url: null, raw: 'javascript:go()', reason: 'javascript-url' }],
    }
    expect(parseIssueEvidence(links)).toEqual(links)
    const canonicals = {
      kind: 'canonicals',
      total: 1,
      items: [{ raw: '/x', url: 'https://example.com/x', inHead: false, source: null }],
    }
    expect(parseIssueEvidence(canonicals)).toEqual(canonicals)
    const related = { kind: 'related-urls', total: 30, atLeast: true, urls: ['https://a.test/'] }
    expect(parseIssueEvidence(related)).toEqual(related)
  })

  it.each([
    ['nothing', null],
    ['a list', []],
    ['a kind it does not know', { kind: 'screenshots', total: 1, items: [] }],
    ['a negative total', { ...images, total: -1 }],
    ['a total that is not a number', { ...images, total: '3' }],
    ['items that are not a list', { ...images, items: 'a.png' }],
    ['urls that are not a list', { kind: 'related-urls', total: 1, urls: 'https://a.test/' }],
  ])('refuses %s', (_, value) => {
    expect(parseIssueEvidence(value)).toBeNull()
  })

  it('leaves out the items that are not what they should be', () => {
    const parsed = parseIssueEvidence({
      kind: 'links',
      total: 4,
      items: [
        { kind: 'anchor', url: 'https://a.test/' },
        { kind: 'not-a-kind', url: 'https://b.test/' },
        { url: 'https://c.test/' },
        'https://d.test/',
        { kind: 'form', url: 'https://e.test/' },
      ],
    })
    expect(parsed).toEqual({
      kind: 'links',
      total: 4,
      items: [
        { kind: 'anchor', url: 'https://a.test/' },
        { kind: 'form', url: 'https://e.test/' },
      ],
    })
  })

  it('keeps it bounded again, whatever was stored', () => {
    const parsed = parseIssueEvidence({
      kind: 'images',
      total: 500,
      items: Array.from({ length: 100 }, () => ({
        src: 'x'.repeat(5000),
        url: `https://example.com/${'y'.repeat(MAX_EVIDENCE_URL)}`,
        class: 'c'.repeat(5000),
        alt: 'a'.repeat(5000),
      })),
    })
    if (parsed?.kind !== 'images') throw new Error('not images')
    expect(parsed.total).toBe(500)
    expect(parsed.items).toHaveLength(MAX_EVIDENCE_ITEMS)
    for (const item of parsed.items) {
      expect(item.src.length).toBeLessThanOrEqual(MAX_EVIDENCE_TEXT)
      expect(item.class?.length).toBeLessThanOrEqual(MAX_EVIDENCE_TEXT)
      expect(item.alt?.length).toBeLessThanOrEqual(MAX_EVIDENCE_TEXT)
      // Too long to be something to link to.
      expect(item.url).toBeNull()
    }
  })

  it('refuses what is not an envelope, and reads fields that are missing or odd as absent', () => {
    for (const bad of [
      null,
      [],
      'x',
      { kind: 'images', items: [] },
      { kind: 'images', total: -1, items: [] },
      { kind: 'images', total: 1.5, items: [] },
      { kind: 'images', total: 1, items: 'x' },
      { kind: 'nope', total: 1 },
    ]) {
      expect(parseIssueEvidence(bad)).toBeNull()
    }
    expect(
      parseIssueEvidence({
        kind: 'canonicals',
        total: 1,
        items: [{ raw: 'x', url: 5, inHead: 'yes', source: 'other' }, { raw: 3 }, 'x', []],
      }),
    ).toEqual({
      kind: 'canonicals',
      total: 1,
      items: [{ raw: 'x', url: null, inHead: false, source: null }],
    })
    expect(
      parseIssueEvidence({
        kind: 'links',
        total: 1,
        items: [{ kind: 'anchor', url: 'https://a.test/', reason: 'other', text: 4 }],
      }),
    ).toEqual({ kind: 'links', total: 1, items: [{ kind: 'anchor', url: 'https://a.test/' }] })
  })

  it('does not keep a related URL it was not given as text, nor a long one', () => {
    expect(
      parseIssueEvidence({
        kind: 'related-urls',
        total: 3,
        urls: [
          'https://a.test/',
          42,
          { href: 'https://b.test/' },
          `https://c.test/${'z'.repeat(3000)}`,
        ],
      }),
    ).toEqual({ kind: 'related-urls', total: 3, urls: ['https://a.test/'] })
  })
})

it('bounds field evidence and drops unsupported fields without inventing values', () => {
  expect(
    parseIssueEvidence({
      kind: 'values',
      total: 2,
      items: [
        { field: 'h1', text: 'a\nb' },
        { field: 'unsupported', text: 'no' },
      ],
    }),
  ).toEqual({ kind: 'values', total: 2, items: [{ field: 'h1', text: 'a b' }] })
})
