import { describe, expect, it } from 'vitest'
import {
  CRAWL_URL_VIEWS,
  STATUS_FILTERS,
  URL_TYPES,
  URL_VIEWS,
  VIEW_KINDS,
  isStatusFilter,
  isUrlType,
  statusRange,
  viewHasTypes,
  viewIsAudited,
} from './listing'

describe('views', () => {
  it('offer pages, resources, redirects, external URLs and everything, and keep "other" for links', () => {
    expect(URL_VIEWS).toEqual(['pages', 'resources', 'redirects', 'external', 'all'])
    expect(CRAWL_URL_VIEWS).toEqual([...URL_VIEWS, 'other'])
  })

  it('say what a URL of the site can be in each, and nothing for external URLs', () => {
    expect(VIEW_KINDS.pages).toEqual(['page'])
    expect(VIEW_KINDS.other).not.toContain('page')
    expect(VIEW_KINDS.external).toEqual([])
    expect([...VIEW_KINDS.all].sort()).toEqual([...URL_TYPES].sort())
  })

  it('only offer a type to pick where there is more than one', () => {
    expect(CRAWL_URL_VIEWS.filter(viewHasTypes)).toEqual(['all', 'other'])
  })

  it('audit everything but external URLs', () => {
    expect(CRAWL_URL_VIEWS.filter((view) => !viewIsAudited(view))).toEqual(['external'])
  })
})

describe('status filters', () => {
  it('are the classes of status codes and having none', () => {
    expect(STATUS_FILTERS).toEqual(['2xx', '3xx', '4xx', '5xx', 'none'])
    expect(isStatusFilter('4xx')).toBe(true)
    for (const bad of ['404', '1xx', 'NONE', '', undefined, 4])
      expect(isStatusFilter(bad)).toBe(false)
  })

  it('cover the codes of their hundred, the upper one excluded', () => {
    expect(statusRange('2xx')).toEqual({ min: 200, max: 300 })
    expect(statusRange('5xx')).toEqual({ min: 500, max: 600 })
  })
})

describe('types', () => {
  it('are what a URL turned out to be', () => {
    expect(isUrlType('unknown')).toBe(true)
    expect(isUrlType('external')).toBe(false)
    expect(isUrlType(undefined)).toBe(false)
  })
})
