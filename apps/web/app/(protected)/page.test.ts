import { beforeEach, describe, expect, it, vi } from 'vitest'
import HomePage from './page'
import DomainsPage from './domains/page'

const mocks = vi.hoisted(() => ({
  viewer: { session: { user: { id: 'member' } }, role: 'member' },
  companies: vi.fn(),
  favourite: vi.fn(),
}))
vi.mock('@/lib/session', () => ({ requireViewer: async () => mocks.viewer }))
vi.mock('@/lib/workspace', () => ({ visibleCompanies: mocks.companies }))
vi.mock('@/lib/db', () => ({
  getDb: async () => ({ userPreferences: { favouriteDomainId: mocks.favourite } }),
}))
vi.mock('@/components/portfolio/domain-portfolio', () => ({ DomainPortfolio: () => null }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => () => '' }))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
const domains = [
  { id: 'a', host: 'a.com', archivedAt: null },
  { id: 'b', host: 'b.com', archivedAt: null },
]

describe('home and all domains', () => {
  beforeEach(() => {
    mocks.viewer.role = 'member'
    mocks.companies.mockResolvedValue([{ domains }])
    mocks.favourite.mockResolvedValue(null)
  })
  it('opens a visible favourite before the portfolio', async () => {
    mocks.favourite.mockResolvedValue('b')
    await expect(HomePage()).rejects.toThrow('redirect:/domains/b.com')
  })
  it('ignores a favourite that is no longer visible', async () => {
    mocks.favourite.mockResolvedValue('hidden')
    expect((await HomePage()).props.companies).toEqual([{ domains }])
  })
  it('keeps all domains reachable with a favourite and with just one domain', async () => {
    mocks.favourite.mockResolvedValue('a')
    mocks.companies.mockResolvedValue([{ domains: domains.slice(0, 1) }])
    expect((await DomainsPage()).props.companies[0].domains).toHaveLength(1)
    await expect(HomePage()).rejects.toThrow('redirect:/domains/a.com')
  })
  it('opens the only archived domain when there is no active domain', async () => {
    mocks.companies.mockResolvedValue([{ domains: [{ ...domains[0], archivedAt: new Date() }] }])
    await expect(HomePage()).rejects.toThrow('redirect:/domains/a.com')
  })
  it.each([HomePage, DomainsPage])('keeps the no-access fallback', async (page) => {
    mocks.companies.mockResolvedValue([])
    await expect(page()).rejects.toThrow('redirect:/no-access')
    mocks.viewer.role = 'admin'
    await expect(page()).rejects.toThrow('redirect:/onboarding')
    mocks.companies.mockResolvedValue([{ domains: [] }])
    await expect(page()).rejects.toThrow('redirect:/system/companies')
  })
})
