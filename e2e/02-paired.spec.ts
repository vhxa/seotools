import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './support/test'
import { ADMIN_STATE, HOST } from './support/env'
test.use({ storageState: ADMIN_STATE })
test('opens the paired answers from a completed crawl', async ({ page }) => {
  const screenshots = process.env.PAIRED_SCREENSHOTS
  if (screenshots) await mkdir(screenshots, { recursive: true })
  await page.goto(`/domains/${HOST}`)
  await expect(
    page.getByText(
      'This site answered 1 of 5 checked pages differently when requested twice during this crawl.',
    ),
  ).toBeVisible()
  await page.goto(`/domains/${HOST}/crawls`)
  await page.getByText('Paired requests', { exact: true }).last().click()
  await page.getByText('Show examples', { exact: true }).click()
  const link = page.getByRole('link', {
    name: 'https://example.com/products?sort=price',
    exact: true,
  })
  await expect(link).toBeVisible()
  if (screenshots) await page.screenshot({ path: join(screenshots, 'crawl-details.png') })
  await link.click()
  await expect(page.getByText('First answer', { exact: true })).toBeVisible()
  await expect(page.getByText('Second answer', { exact: true })).toBeVisible()
  await expect(
    page
      .locator('section')
      .filter({ has: page.getByText('First answer', { exact: true }) })
      .locator('time'),
  ).toHaveCount(2)
  await expect(page.getByText('A different product listing', { exact: true })).toBeVisible()
  if (screenshots) await page.screenshot({ path: join(screenshots, 'url-detail.png') })
})
