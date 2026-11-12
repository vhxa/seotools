import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setFavouriteAction } from './favourite-actions'

const mocks = vi.hoisted(() => ({
  viewer: { session: { user: { id: 'member' } }, role: 'member' },
  companies: vi.fn(),
  favourite: vi.fn(),
  set: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock('@/lib/session', () => ({ requireViewer: async () => mocks.viewer }))
vi.mock('@/lib/workspace', () => ({ visibleCompanies: mocks.companies }))
vi.mock('@/lib/db', () => ({
  getDb: async () => ({
    userPreferences: {
      favouriteDomainId: mocks.favourite,
      setFavouriteDomain: mocks.set,
    },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found')
  },
}))

describe('personal favourite action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.companies.mockResolvedValue([{ domains: [{ id: 'visible', host: 'example.com' }] }])
    mocks.favourite.mockResolvedValue(null)
  })
  it('allows a member to choose a visible domain, replacing any previous favourite', async () => {
    mocks.favourite.mockResolvedValue('previous')
    await setFavouriteAction('example.com', true)
    expect(mocks.companies).toHaveBeenCalledWith(mocks.viewer)
    expect(mocks.set).toHaveBeenCalledWith('member', 'visible')
    expect(mocks.revalidate).toHaveBeenCalledWith('/', 'layout')
  })
  it('clears the current favourite', async () => {
    mocks.favourite.mockResolvedValue('visible')
    await setFavouriteAction('example.com', false)
    expect(mocks.set).toHaveBeenCalledWith('member', null)
  })
  it('keeps a favourite chosen elsewhere when a stale star is cleared', async () => {
    mocks.favourite.mockResolvedValue('other')
    await setFavouriteAction('example.com', false)
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it('sets the favourite again without flipping it off', async () => {
    mocks.favourite.mockResolvedValue('visible')
    await setFavouriteAction('example.com', true)
    expect(mocks.set).toHaveBeenCalledWith('member', 'visible')
  })
  it.each(['hidden.com', '', 'x'.repeat(254)])(
    'refuses invalid or invisible host %s',
    async (host) => {
      await expect(setFavouriteAction(host, true)).rejects.toThrow('not-found')
      expect(mocks.set).not.toHaveBeenCalled()
    },
  )
})
