import { describe, expect, it } from 'vitest'
import { grantTarget, parseGrants, parseUserRole } from './user-forms'

describe('parseGrants', () => {
  const sent = (rows: unknown) => JSON.stringify(rows)

  it('reads rows as grants, the last of a target standing', () => {
    expect(
      parseGrants(
        sent([
          { target: 'company:c1', role: 'viewer' },
          { target: 'domain:d1', role: 'editor' },
          { target: 'company:c1', role: 'editor' },
        ]),
      ),
    ).toEqual([
      { role: 'editor', companyId: 'c1', domainId: null },
      { role: 'editor', companyId: null, domainId: 'd1' },
    ])
    expect(parseGrants(sent([]))).toEqual([])
    expect(parseGrants(null)).toEqual([])
  })

  it('refuses the whole of what is not a grant', () => {
    for (const rows of [
      'not json',
      sent({ target: 'company:c1', role: 'viewer' }),
      sent([{ target: 'company:c1', role: 'admin' }]),
      sent([{ target: 'user:u1', role: 'viewer' }]),
      sent([{ target: 'company:', role: 'viewer' }]),
      sent([{ role: 'viewer' }]),
      sent([null]),
    ]) {
      expect(parseGrants(rows)).toBeNull()
    }
  })

  it('goes back and forth with the targets of a form', () => {
    const grant = { role: 'viewer', companyId: null, domainId: 'd1' } as const
    expect(parseGrants(sent([{ target: grantTarget(grant), role: 'viewer' }]))).toEqual([grant])
  })
})

describe('parseUserRole', () => {
  it('knows only the two roles', () => {
    expect(parseUserRole('admin')).toBe('admin')
    expect(parseUserRole('member')).toBe('member')
    expect(parseUserRole('owner')).toBeNull()
    expect(parseUserRole(null)).toBeNull()
  })
})
