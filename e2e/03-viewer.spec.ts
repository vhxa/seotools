import { createDatabase, inviteUser, redeemUserToken } from '@seotools/db'
import { expect, test } from './support/test'
import { DATABASE_URL, HOST, OTHER_HOST, VIEWER, VIEWER_STATE } from './support/env'
import { signIn } from './support/helpers'

const domain = `/domains/${HOST}`

test.describe('a member with a viewer grant on one domain', () => {
  test.use({ storageState: VIEWER_STATE })

  test.beforeAll(async ({ browser }) => {
    // The accounts exist after the first run: an invitation, redeemed the way the link does.
    const db = await createDatabase({ url: DATABASE_URL, dialect: 'sqlite' })
    try {
      const companies = await db.companies.list()
      const granted = companies.flatMap((company) => company.domains).find((d) => d.host === HOST)
      if (!granted) throw new Error('the seed domain is missing')
      const invited = await inviteUser(db, {
        name: VIEWER.name,
        email: VIEWER.email,
        role: 'member',
        grants: [{ role: 'viewer', companyId: null, domainId: granted.id }],
      })
      if (!invited.ok) throw new Error(`could not invite the viewer: ${invited.reason}`)
      if (!(await redeemUserToken(db, { token: invited.token, password: VIEWER.password }))) {
        throw new Error('could not set the password of the viewer')
      }
    } finally {
      await db.close()
    }
    // Signed in once: the sign-in endpoint is rate limited.
    const context = await browser.newContext({ storageState: undefined })
    await signIn(await context.newPage(), VIEWER)
    await context.storageState({ path: VIEWER_STATE })
    await context.close()
  })

  test('sees the domain they were given, read only', async ({ page }) => {
    await page.goto(domain)
    await expect(page.getByRole('heading', { name: HOST, level: 1 })).toBeVisible()
    await expect(page.getByText(/Last full crawl finished/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run full crawl' })).toHaveCount(0)

    await page.goto(`${domain}/urls`)
    await expect(page.getByRole('heading', { name: 'URLs', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark as priority' })).toHaveCount(0)
  })

  test('reads the Crawls area without being offered to run anything', async ({ page }) => {
    await page.goto(`${domain}/crawls`)
    await expect(page.getByRole('heading', { name: 'Crawls', level: 1 })).toBeVisible()
    await expect(page.getByRole('table').getByText('completed')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run full crawl' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Run priority crawl' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Crawl a URL list' })).toHaveCount(0)
  })

  test('can read bot access results without being offered a request button', async ({ page }) => {
    await page.goto(`${domain}/crawl-files/robots`)
    await expect(page.getByText('Bot access test', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Test(ing)? bot access/ })).toHaveCount(0)
  })

  test('does not find a domain without a grant, nor the administration', async ({ page }) => {
    const missing = await page.goto(`/domains/${OTHER_HOST}`)
    expect(missing?.status()).toBe(404)

    await page.goto(domain)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(0)

    const integrations = await page.goto('/system/integrations')
    expect(integrations?.status()).toBe(404)
    const system = await page.goto('/system')
    expect(system?.status()).toBe(404)
  })
})
