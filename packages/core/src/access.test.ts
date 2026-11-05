import { describe, expect, it } from 'vitest'
import {
  accessAfterMove,
  canEditDomain,
  domainRoleOf,
  uniqueGrants,
  type AccessGrant,
} from './access'

const domain = { id: 'd1', companyId: 'c1' }
const onCompany = (role: 'editor' | 'viewer', companyId = 'c1'): AccessGrant => ({
  role,
  companyId,
  domainId: null,
})
const onDomain = (role: 'editor' | 'viewer', domainId = 'd1'): AccessGrant => ({
  role,
  companyId: null,
  domainId,
})
const member = (...grants: AccessGrant[]) => ({ role: 'member' as const, grants })

describe('domainRoleOf', () => {
  it('gives a member nothing that was not given', () => {
    expect(domainRoleOf(member(), domain)).toBeNull()
    expect(
      domainRoleOf(member(onCompany('editor', 'c2'), onDomain('editor', 'd2')), domain),
    ).toBeNull()
  })

  it('gives an administrator everything, whatever else was given', () => {
    expect(domainRoleOf({ role: 'admin', grants: [] }, domain)).toBe('admin')
    expect(domainRoleOf({ role: 'admin', grants: [onDomain('viewer')] }, domain)).toBe('admin')
  })

  it('covers the domains of a company, and the domain decides over its company either way', () => {
    expect(domainRoleOf(member(onCompany('viewer')), domain)).toBe('viewer')
    expect(domainRoleOf(member(onCompany('viewer'), onDomain('editor')), domain)).toBe('editor')
    expect(domainRoleOf(member(onCompany('editor'), onDomain('viewer')), domain)).toBe('viewer')
  })

  it('lets only editors and administrators change anything', () => {
    expect(canEditDomain('admin')).toBe(true)
    expect(canEditDomain('editor')).toBe(true)
    expect(canEditDomain('viewer')).toBe(false)
    expect(canEditDomain(null)).toBe(false)
  })
})

describe('uniqueGrants', () => {
  it('keeps the last grant given for each target', () => {
    expect(uniqueGrants([onDomain('viewer'), onCompany('viewer'), onDomain('editor')])).toEqual([
      onDomain('editor'),
      onCompany('viewer'),
    ])
  })
})

describe('accessAfterMove', () => {
  const user = (id: string, grants: AccessGrant[], role: 'admin' | 'member' = 'member') => ({
    id,
    role,
    grants,
  })
  const move = { domainId: 'd1', from: 'c1', to: 'c2' }
  const ids = (users: { id: string }[]) => users.map(({ id }) => id)

  it('says who gains and who loses it through their companies', () => {
    const { gain, lose } = accessAfterMove(
      [user('old', [onCompany('editor', 'c1')]), user('new', [onCompany('viewer', 'c2')])],
      move,
    )
    expect(ids(gain)).toEqual(['new'])
    expect(ids(lose)).toEqual(['old'])
  })

  it('leaves out who has it on the domain, on both companies, or sees everything', () => {
    const { gain, lose } = accessAfterMove(
      [
        user('own', [onDomain('viewer'), onCompany('editor', 'c1')]),
        user('both', [onCompany('viewer', 'c1'), onCompany('viewer', 'c2')]),
        user('admin', [], 'admin'),
        user('none', []),
      ],
      move,
    )
    expect(gain).toEqual([])
    expect(lose).toEqual([])
  })
})
