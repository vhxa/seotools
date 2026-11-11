import { describe, expect, it } from 'vitest'
import {
  referenceGroup,
  DEFAULT_LINK_FILTER,
  LINK_GROUPS,
  LINK_GROUP_OF,
  MAX_LINK_SEARCH_LENGTH,
  filterKinds,
  foldLinkKindCounts,
  linkGroupCounts,
  linkKindsOf,
  parseLinkFilter,
} from './links'
import { CRAWL_LINK_KINDS } from './types'

describe('link groups', () => {
  it('place every type of link in exactly one group', () => {
    for (const kind of CRAWL_LINK_KINDS) expect(LINK_GROUPS).toContain(LINK_GROUP_OF[kind])
    const listed = LINK_GROUPS.flatMap((group) => linkKindsOf(group))
    expect([...listed].sort()).toEqual([...CRAWL_LINK_KINDS].sort())
    expect(linkKindsOf('all')).toEqual([...CRAWL_LINK_KINDS])
  })

  it('keep what people click apart from what a page loads', () => {
    expect(linkKindsOf('navigation')).toEqual(['anchor', 'anchor-nofollow'])
    expect(linkKindsOf('resources')).toEqual(
      expect.arrayContaining(['script', 'style', 'image', 'other']),
    )
    expect(linkKindsOf('resources')).not.toContain('anchor')
    expect(linkKindsOf('declared')).toEqual(expect.arrayContaining(['canonical', 'redirect']))
  })
})

describe('parseLinkFilter', () => {
  it('opens on navigation links, whatever it is given that makes no sense', () => {
    expect(DEFAULT_LINK_FILTER).toEqual({ group: 'navigation', kind: null, search: '' })
    for (const input of [undefined, null, 'x', 4, [], {}, { group: 'nope', kind: 7, search: {} }]) {
      expect(parseLinkFilter(input)).toEqual(DEFAULT_LINK_FILTER)
    }
  })

  it('keeps a type only inside its group, and any type under all', () => {
    expect(parseLinkFilter({ group: 'resources', kind: 'image' })).toMatchObject({
      group: 'resources',
      kind: 'image',
    })
    expect(parseLinkFilter({ group: 'navigation', kind: 'image' }).kind).toBeNull()
    expect(parseLinkFilter({ group: 'all', kind: 'image' })).toMatchObject({
      group: 'all',
      kind: 'image',
    })
    expect(parseLinkFilter({ group: 'all', kind: 'toString' }).kind).toBeNull()
    expect(parseLinkFilter({ group: '__proto__' }).group).toBe('navigation')
  })

  it('trims and bounds the search', () => {
    expect(parseLinkFilter({ search: '  /blog  ' }).search).toBe('/blog')
    expect(parseLinkFilter({ search: 'x'.repeat(10_000) }).search).toHaveLength(
      MAX_LINK_SEARCH_LENGTH,
    )
  })
})

describe('filterKinds', () => {
  it('says which types a filter keeps, with none for all of them', () => {
    expect(filterKinds({ group: 'all', kind: null })).toBeUndefined()
    expect(filterKinds({ group: 'navigation', kind: null })).toEqual(['anchor', 'anchor-nofollow'])
    expect(filterKinds({ group: 'navigation', kind: 'anchor-nofollow' })).toEqual([
      'anchor-nofollow',
    ])
    expect(filterKinds({ group: 'all', kind: 'sitemap' })).toEqual(['sitemap'])
  })
})

describe('counts', () => {
  it('give every type a number, and ignore what is not a type', () => {
    const counts = foldLinkKindCounts([
      { kind: 'anchor', count: 3 },
      { kind: 'image', count: 2 },
      { kind: 'image', count: 1 },
      { kind: 'not-a-kind', count: 9 },
    ])
    expect(Object.keys(counts).sort()).toEqual([...CRAWL_LINK_KINDS].sort())
    expect(counts).toMatchObject({ anchor: 3, image: 3, script: 0 })
  })

  it('add up by group, and in total', () => {
    const counts = foldLinkKindCounts([
      { kind: 'anchor', count: 3 },
      { kind: 'anchor-nofollow', count: 1 },
      { kind: 'script', count: 2 },
      { kind: 'canonical', count: 1 },
    ])
    expect(linkGroupCounts(counts)).toEqual({
      navigation: 4,
      resources: 2,
      declared: 1,
      all: 7,
    })
  })
})

describe('reference groups', () => {
  it('combines navigation and resource kinds while keeping declarations separate', () => {
    expect(referenceGroup('anchor-nofollow')).toBe(referenceGroup('anchor'))
    expect(referenceGroup('script')).toBe(referenceGroup('image'))
    expect(referenceGroup('canonical')).toBe('canonical')
    expect(referenceGroup('hreflang')).toBe('hreflang')
    expect(referenceGroup('sitemap')).toBe('sitemap')
  })
})
