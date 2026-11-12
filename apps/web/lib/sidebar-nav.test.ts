import { describe, expect, it } from 'vitest'
import { isNavActive, isSectionOpen } from './sidebar-nav'

describe('isNavActive', () => {
  const crawls = { href: '/domains/a.com/crawls' }
  it('matches the path and every page under it', () => {
    expect(isNavActive(crawls, '/domains/a.com/crawls')).toBe(true)
    expect(isNavActive(crawls, '/domains/a.com/crawls/compare')).toBe(true)
    expect(isNavActive(crawls, '/domains/a.com/crawls/rechecks/abc')).toBe(true)
    expect(isNavActive(crawls, '/domains/a.com/urls')).toBe(false)
    expect(isNavActive(crawls, '/domains/a.com/crawlsX')).toBe(false)
  })
  it('matches the paths it claims, and their sub-pages', () => {
    const urls = { href: '/domains/a.com/urls', also: ['/domains/a.com/other'] }
    expect(isNavActive(urls, '/domains/a.com/urls/abc')).toBe(true)
    expect(isNavActive(urls, '/domains/a.com/other')).toBe(true)
    expect(isNavActive(urls, '/domains/a.com/other/x')).toBe(true)
    expect(isNavActive(urls, '/domains/a.com/crawls')).toBe(false)
  })
  it('exact links ignore sub-pages', () => {
    const overview = { href: '/domains/a.com', exact: true }
    expect(isNavActive(overview, '/domains/a.com')).toBe(true)
    expect(isNavActive(overview, '/domains/a.com/issues')).toBe(false)
  })
})

describe('isSectionOpen', () => {
  it('follows the active state without an override', () => {
    expect(isSectionOpen(true, null, '/x')).toBe(true)
    expect(isSectionOpen(false, null, '/x')).toBe(false)
  })
  it('opens after navigating into the section', () => {
    const folded = { pathname: '/a', open: false }
    expect(isSectionOpen(true, folded, '/b')).toBe(true)
  })
  it('keeps a manual toggle on the same page', () => {
    expect(isSectionOpen(true, { pathname: '/a', open: false }, '/a')).toBe(false)
    expect(isSectionOpen(false, { pathname: '/a', open: true }, '/a')).toBe(true)
  })
})
