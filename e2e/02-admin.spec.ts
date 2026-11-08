import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { ADMIN_STATE, HOST } from './support/env'

const domain = `/domains/${HOST}`

// Signed in once by the first spec: the sign-in endpoint is rate limited.
test.use({ storageState: ADMIN_STATE })

test('the overview shows the figures and priorities of the last full crawl', async ({ page }) => {
  await page.goto(domain)
  await expect(page.getByRole('heading', { name: HOST, level: 1 })).toBeVisible()
  await expect(page.getByText(/Last full crawl finished/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run full crawl' })).toBeVisible()

  const figures = page.getByRole('region', { name: /^Last full crawl/ })
  await expect(figures.getByText('Pages crawled')).toBeVisible()
  await expect(figures.getByText('of 4 crawled')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Findings to review first' })).toBeVisible()
})

test('the issues page lists what the crawl found, and each issue opens the URLs that have it', async ({
  page,
}) => {
  await page.goto(`${domain}/issues`)
  await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: /^High importance/ })).toBeVisible()

  await page.getByRole('link', { name: /Client error 4xx \(internal\)/ }).click()
  await expect(page).toHaveURL(/issue=client-error/)
  await expect(
    page.getByRole('link', { name: 'https://example.com/missing', exact: true }),
  ).toBeVisible()
})

test('the URLs table has its views with counts, and a search', async ({ page }) => {
  await page.goto(`${domain}/pages/details`)
  await expect(page.getByRole('heading', { name: 'URLs', level: 1 })).toBeVisible()

  const views = page.getByRole('navigation', { name: 'Views' })
  await expect(views.getByRole('link', { name: /^Pages 4$/ })).toBeVisible()
  await expect(views.getByRole('link', { name: /^Redirects 1$/ })).toBeVisible()
  await expect(views.getByRole('link', { name: /^Resources \d+$/ })).toBeVisible()
  await expect(views.getByRole('link', { name: /^External \d+$/ })).toBeVisible()

  await views.getByRole('link', { name: /^Redirects/ }).click()
  await expect(page).toHaveURL(/view=redirects/)
  await expect(
    page.getByRole('link', { name: 'https://example.com/old', exact: true }),
  ).toBeVisible()

  await views.getByRole('link', { name: /^Pages/ }).click()
  await expect(page).not.toHaveURL(/view=redirects/)
  await page.getByRole('searchbox', { name: 'Search URLs' }).fill('products')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/q=products/)
  await expect(
    page.getByRole('link', { name: 'https://example.com/products', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'https://example.com/about', exact: true }),
  ).toHaveCount(0)
})

test('a URL opens in a drawer and as a full page, with how it was found', async ({ page }) => {
  await page.goto(`${domain}/pages/details`)
  await page.getByRole('link', { name: 'https://example.com/products?sort=price' }).first().click()

  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText('How it was found')).toBeVisible()

  await drawer.getByRole('link', { name: 'Open full screen' }).click()
  await expect(page).toHaveURL(/\/pages\/details\/[0-9a-f]{32}/)
  await expect(page.getByText('How it was found')).toBeVisible()
  await expect(page.getByText('https://example.com/products?sort=price').first()).toBeVisible()
})

test('the header search finds a URL of the domain and opens its detail', async ({ page }) => {
  await page.goto(`${domain}/issues`)
  await page.getByRole('combobox', { name: 'Search the URLs of this domain' }).fill('about')
  await page.getByRole('option', { name: /https:\/\/example\.com\/about/ }).click()
  await expect(page).toHaveURL(/\/pages\/details\/[0-9a-f]{32}/)
  await expect(page.getByRole('heading', { name: 'https://example.com/about' })).toBeVisible()
})

test('System and the account have no sidebar; the account has its tabs', async ({ page }) => {
  await page.goto(domain)
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await page.getByRole('link', { name: 'Administration' }).click()
  await expect(page).toHaveURL(/\/system$/)
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)

  await page.goto('/account')
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Profile' })).toBeVisible()
  await page.getByRole('tab', { name: 'Password' }).click()
  await expect(page).toHaveURL(/\/account\?tab=password$/)
  await expect(page.getByLabel('Current password')).toBeVisible()
})

test('the query parameters page shows where a parameter enters the site', async ({ page }) => {
  await page.goto(`${domain}/pages/parameters`)
  await expect(page.getByRole('heading', { name: 'Query parameters', level: 1 })).toBeVisible()

  const found = page.getByRole('region', { name: 'Parameters found' })
  await expect(found.getByRole('cell', { name: 'sort' })).toBeVisible()

  const entries = page.getByRole('region', { name: 'Where they enter the site' })
  await expect(
    entries.getByRole('link', { name: 'https://example.com/products', exact: true }),
  ).toBeVisible()
  await expect(entries.getByText('by price')).toBeVisible()
  await expect(entries.getByText('Main content')).toBeVisible()
})

test('the pages export downloads a CSV with its header row', async ({ page }) => {
  await page.goto(`${domain}/pages/details`)
  await page.getByRole('button', { name: 'Export' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: /^Pages/ }).click()

  const file = await download
  expect(file.suggestedFilename()).toMatch(/\.csv$/)
  const csv = await readFile((await file.path())!, 'utf8')
  const [header, ...rows] = csv.replace(/^\uFEFF/, '').split(/\r?\n/)
  expect(header).toContain('URL')
  expect(header).toContain('HTTP status')
  expect(header).toContain('Technical state')
  expect(rows.join('\n')).toContain('https://example.com/about')
})
