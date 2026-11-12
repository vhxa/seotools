import type { CrawlPageFacts } from '@seotools/core'
import { describe, expect, it } from 'vitest'
import {
  GOOGLE_DESCRIPTION_MAX,
  GOOGLE_TITLE_MAX,
  breadcrumbsOf,
  cutNear,
  recheckSharePreview,
  shareImageOf,
  sharePreview,
} from './share-preview'

const factsWith = (social: NonNullable<CrawlPageFacts['social']>) =>
  ({ social }) as unknown as CrawlPageFacts

describe('cutNear', () => {
  it('leaves what fits and marks what it cuts', () => {
    expect(cutNear('  A  short   title ', 60)).toBe('A short title')
    expect(cutNear('abcdefghij', 5)).toBe('abcde…')
    expect(cutNear('abcd efghij', 5)).toBe('abcd…')
  })
})

describe('breadcrumbsOf', () => {
  it('splits the address as a result shows it', () => {
    expect(breadcrumbsOf('https://example.com/blog/post?x=1')).toEqual({
      host: 'example.com',
      segments: ['blog', 'post'],
    })
    expect(breadcrumbsOf('https://example.com/')).toEqual({ host: 'example.com', segments: [] })
  })

  it('decodes, tolerates broken escapes and leaves out a long path', () => {
    expect(breadcrumbsOf('https://example.com/caf%C3%A9/%E0%A4%A').segments).toEqual([
      'café',
      '%E0%A4%A',
    ])
    expect(breadcrumbsOf('https://example.com/a/b/c/d/e/f').segments).toEqual([
      'a',
      'b',
      'c',
      'd',
      '…',
    ])
    expect(breadcrumbsOf('not a url')).toEqual({ host: 'not a url', segments: [] })
  })
})

describe('shareImageOf', () => {
  it('shows only what the app loads: https', () => {
    expect(shareImageOf('https://cdn.example.net/a.png')).toEqual({
      kind: 'https',
      url: 'https://cdn.example.net/a.png',
    })
    expect(shareImageOf('http://cdn.example.net/a.png').kind).toBe('insecure')
    for (const bad of [undefined, '', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'x']) {
      expect(shareImageOf(bad).kind).toBe('none')
    }
  })
})

describe('sharePreview', () => {
  const page = {
    url: 'https://example.com/blog/post',
    title: 'T'.repeat(80),
    data: { description: 'D'.repeat(200) },
  }

  it('cuts the title and description where a result does', () => {
    const { google } = sharePreview(page)
    expect(google.title).toBe(`${'T'.repeat(GOOGLE_TITLE_MAX)}…`)
    expect(google.description).toBe(`${'D'.repeat(GOOGLE_DESCRIPTION_MAX)}…`)
    expect(google).toMatchObject({ host: 'example.com', segments: ['blog', 'post'] })
  })

  it('says nothing where the page has no title or description', () => {
    const { google } = sharePreview({ url: page.url, title: '  ', data: null })
    expect(google.title).toBeNull()
    expect(google.description).toBeNull()
  })

  it('has no social side for a crawl that did not look for the tags', () => {
    expect(sharePreview(page).social).toBeNull()
    expect(sharePreview({ ...page, data: { ...page.data, facts: undefined } }).social).toBeNull()
  })

  it('reads the card from the tags, falling back to what the page has', () => {
    const social = sharePreview({
      ...page,
      title: 'The title',
      data: {
        description: 'The description',
        facts: factsWith({
          openGraphTags: 3,
          title: 'Shared title',
          image: 'https://cdn.example.net/a.png',
          siteName: 'Example',
          twitterCard: 'summary_large_image',
        }),
      },
    }).social
    expect(social).toEqual({
      untagged: false,
      card: 'summary_large_image',
      image: { kind: 'https', url: 'https://cdn.example.net/a.png' },
      title: 'Shared title',
      description: 'The description',
      host: 'example.com',
      siteName: 'Example',
    })
  })

  it('falls back to the twitter tags and marks a page with no Open Graph tags', () => {
    const social = sharePreview({
      ...page,
      data: {
        facts: factsWith({
          openGraphTags: 0,
          twitterImage: 'http://cdn.example.net/t.png',
          twitterTitle: 'Tweet',
        }),
      },
    }).social
    expect(social).toMatchObject({
      untagged: true,
      image: { kind: 'insecure' },
      title: 'Tweet',
      description: null,
    })
  })
})

describe('recheckSharePreview', () => {
  const url = 'https://example.com/blog/post'

  it('builds the same preview as the crawl from what the recheck read', () => {
    const fromCrawl = sharePreview({
      url,
      title: 'The title',
      data: {
        description: 'The description',
        facts: factsWith({
          openGraphTags: 2,
          title: 'Shared',
          image: 'https://cdn.example.net/a.png',
          twitterCard: 'summary',
        }),
      },
    })
    const fromRecheck = recheckSharePreview(url, {
      title: 'The title',
      description: 'The description',
      social: {
        openGraphTags: 2,
        title: 'Shared',
        image: 'https://cdn.example.net/a.png',
        twitterCard: 'summary',
      },
    })
    expect(fromRecheck).toEqual(fromCrawl)
  })

  it('shows the image address the recheck read, only if it is a web address', () => {
    const preview = (image: string) =>
      recheckSharePreview(url, {
        title: null,
        description: null,
        social: { openGraphTags: 1, image },
      })
    expect(preview('https://cdn.example.net/new.png').social?.image).toEqual({
      kind: 'https',
      url: 'https://cdn.example.net/new.png',
    })
    expect(preview('javascript:alert(1)').social?.image).toEqual({ kind: 'none' })
  })

  it('has a social side even for a page without tags, which the recheck did look for', () => {
    const { social, google } = recheckSharePreview(url, {
      title: null,
      description: null,
      social: { openGraphTags: 0 },
    })
    expect(social).toMatchObject({ untagged: true, title: null })
    expect(google.title).toBeNull()
  })
})
