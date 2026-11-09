import { expect, test } from './support/test'
import { ADMIN, ADMIN_STATE } from './support/env'
import { signIn, signOut } from './support/helpers'

test('the first run creates the administrator, who can sign in and out', async ({
  page,
  browser,
}) => {
  // A fresh installation sends every visitor to the setup.
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup/)

  await page.getByLabel('Name').fill(ADMIN.name)
  await page.getByLabel('Email').fill(ADMIN.email)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password)
  await page.getByLabel('Confirm password').fill(ADMIN.password)
  await page.getByRole('button', { name: 'Create admin account' }).click()
  // Creating the account signs it in: with a domain already there, it lands on that domain.
  await expect(page).toHaveURL(/\/domains\/example\.com/)
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Administration' })).toBeVisible()

  await signOut(page, ADMIN.name)
  await signIn(page, ADMIN)
  await expect(page).toHaveURL(/\/domains\/example\.com/)

  await signOut(page, ADMIN.name)
  // Setup is closed once a user exists.
  await page.goto('/setup')
  await expect(page).toHaveURL(/\/login/)

  // The other specs start from a session of their own: signing in is rate limited.
  const context = await browser.newContext()
  await signIn(await context.newPage(), ADMIN)
  await context.storageState({ path: ADMIN_STATE })
  await context.close()
})
