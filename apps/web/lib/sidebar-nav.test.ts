import { describe, expect, it } from 'vitest'
import { isNavActive, isSectionOpen } from './sidebar-nav'

describe('isNavActive', () => {
  const urls = {
    href: '/domains/a.com/pages/details',
    also: ['/domains/a.com/pages/parameters'],
  }
  it('matches the path, its sub-pages and the paths it claims', () => {
    expect(isNavActive(urls, '/domains/a.com/pages/details')).toBe(true)
    expect(isNavActive(urls, '/domains/a.com/pages/details/abc')).toBe(true)
    expect(isNavActive(urls, '/domains/a.com/pages/parameters')).toBe(true)
    expect(isNavActive(urls, '/domains/a.com/pages/history')).toBe(false)
    expect(isNavActive(urls, '/domains/a.com/pages/detailsX')).toBe(false)
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
