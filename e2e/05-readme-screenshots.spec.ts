import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from './support/test'
import { ADMIN, HOST } from './support/env'

test('capture README screenshots from fake data', async ({ page }) => {
  test.skip(process.env.README_SCREENSHOTS !== '1', 'Opt-in documentation capture')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  // The seed records this synthetic image URL; serve it locally rather than contacting a CDN.
  await page.route('https://cdn.example.net/og.png', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
        <rect width="1200" height="630" fill="#ede9fe"/>
        <circle cx="1000" cy="100" r="320" fill="#ddd6fe"/>
        <rect x="740" y="215" width="200" height="240" rx="24" fill="#7c3aed"/>
        <path d="M800 215v-30a40 40 0 0 1 80 0v30" fill="none" stroke="#7c3aed" stroke-width="18"/>
        <text x="80" y="245" font-family="sans-serif" font-size="36" fill="#6d28d9">EXAMPLE.COM</text>
        <text x="80" y="345" font-family="sans-serif" font-size="76" font-weight="700" fill="#2e1065">Our products</text>
        <text x="80" y="415" font-family="sans-serif" font-size="30" fill="#5b21b6">A fictional store for the demo crawl</text>
      </svg>`,
    }),
  )
  await page.goto('/setup')
  await page.getByLabel('Name').fill(ADMIN.name)
  await page.getByLabel('Email').fill(ADMIN.email)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password)
  await page.getByLabel('Confirm password').fill(ADMIN.password)
  await page.getByRole('button', { name: 'Create admin account' }).click()
  await expect(page).toHaveURL(/localhost:\d+\/$/)
  const output = resolve('docs/screenshots')
  mkdirSync(output, { recursive: true })
  for (const [name, route] of [
    ['dashboard', ''],
    ['issues', '/issues'],
    ['urls', '/urls'],
  ]) {
    await page.goto(`/domains/${HOST}${route}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' })
  }
  await page
    .getByRole('link', { name: 'https://example.com/products', exact: true })
    .first()
    .click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  await drawer.getByRole('link', { name: 'Open full screen' }).click()
  await expect(page).toHaveURL(/\/urls\/[0-9a-f]{32}/)
  await page.getByRole('heading', { name: 'Search and social preview' }).scrollIntoViewIfNeeded()
  await expect(page.getByText('When shared', { exact: true })).toBeVisible()
  await expect(page.locator('img[src="https://cdn.example.net/og.png"]')).toHaveJSProperty(
    'complete',
    true,
  )
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: resolve(output, 'share-preview.png'), animations: 'disabled' })
})
