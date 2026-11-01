import { describe, expect, it } from 'vitest'
import { PAGE_ISSUE_IDS, detectPageIssues, isPageIssueId, type PageSubject } from './issues'

const healthy: PageSubject = {
  statusCode: 200,
  title: 'Home',
  data: { description: 'A description', h1: ['Home'] },
}

describe('detectPageIssues', () => {
  it('finds nothing in a healthy page', () => {
    expect(detectPageIssues(healthy)).toEqual([])
  })

  it('flags error statuses', () => {
    expect(detectPageIssues({ ...healthy, statusCode: 404 })).toEqual(['http-error'])
    expect(detectPageIssues({ ...healthy, statusCode: 500 })).toEqual(['http-error'])
    expect(detectPageIssues({ ...healthy, statusCode: 301 })).toEqual([])
  })

  it('treats a blank title or description as missing', () => {
    expect(detectPageIssues({ ...healthy, title: '  ' })).toEqual(['missing-title'])
    expect(detectPageIssues({ ...healthy, data: null })).toEqual(['missing-description'])
    expect(detectPageIssues({ ...healthy, data: { description: '' } })).toEqual([
      'missing-description',
    ])
  })

  it('lists every issue a page has', () => {
    expect(detectPageIssues({ statusCode: 404, title: null, data: null })).toEqual([
      'http-error',
      'missing-title',
      'missing-description',
    ])
  })
})

describe('isPageIssueId', () => {
  it('only accepts registered issues', () => {
    for (const id of PAGE_ISSUE_IDS) expect(isPageIssueId(id)).toBe(true)
    expect(isPageIssueId('toString')).toBe(false)
    expect(isPageIssueId('nope')).toBe(false)
    expect(isPageIssueId(undefined)).toBe(false)
  })
})
