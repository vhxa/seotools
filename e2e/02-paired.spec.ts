import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './support/test'
import { ADMIN_STATE, HOST, RENDERED_HOST } from './support/env'
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
  if (screenshots) await page.screenshot({ path: join(screenshots, 'overview.png') })
  await page.goto(`/domains/${HOST}/crawls`)
  await page.getByRole('button', { name: 'Details' }).click()
  await expect(page.getByRole('dialog').getByText('Paired requests', { exact: true })).toBeVisible()
  const link = page.getByRole('dialog').getByRole('link', {
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

test('retains the measured total after removing page evidence', async ({ page }) => {
  await page.goto(`/domains/${RENDERED_HOST}/crawls`)
  // The older crawl of the domain is the one whose results were pruned.
  await page.getByRole('button', { name: 'Details' }).last().click()
  const details = page.getByRole('dialog')
  await expect(details.getByText('Results pruned')).toBeVisible()
  await expect(details.getByText('No difference observed in 1 paired check.')).toBeVisible()
  await expect(details.getByText('Retention removed the per-page evidence.')).toBeVisible()
  await expect(details.getByText('Examples', { exact: true })).toHaveCount(0)
})
