import { readFile } from 'node:fs/promises'
import { expect, test } from './support/test'
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
  await expect(figures.getByText('of 5 crawled')).toBeVisible()
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
  await page.goto(`${domain}/urls`)
  await expect(page.getByRole('heading', { name: 'URLs', level: 1 })).toBeVisible()

  const views = page.getByRole('navigation', { name: 'Views' })
  await expect(views.getByRole('link', { name: /^Pages 5$/ })).toBeVisible()
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
  await page.goto(`${domain}/urls`)
  await page.getByRole('link', { name: 'https://example.com/products?sort=price' }).first().click()

  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText('How it was found')).toBeVisible()

  await drawer.getByRole('link', { name: 'Open full screen' }).click()
  await expect(page).toHaveURL(/\/urls\/[0-9a-f]{32}/)
  await expect(page.getByText('How it was found')).toBeVisible()
  await expect(page.getByText('https://example.com/products?sort=price').first()).toBeVisible()
})

test('the header search finds a URL of the domain and opens its detail', async ({ page }) => {
  await page.goto(`${domain}/issues`)
  await page.getByRole('combobox', { name: 'Search the URLs of this domain' }).fill('about')
  await page.getByRole('option', { name: /https:\/\/example\.com\/about/ }).click()
  await expect(page).toHaveURL(/\/urls\/[0-9a-f]{32}/)
  await expect(page.getByRole('heading', { name: 'https://example.com/about' })).toBeVisible()
})

test('the home shows every domain by company, with its last crawl and figures', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'All domains', level: 1 })).toBeVisible()

  const acme = page.getByRole('region', { name: /^Acme/ })
  await expect(acme.getByRole('link', { name: 'Open example.com' })).toBeVisible()
  await expect(acme.getByText(/Last full crawl/)).toBeVisible()
  await expect(acme.getByText('Pages', { exact: true })).toBeVisible()
  await expect(acme.getByText('5', { exact: true })).toBeVisible()
  // A domain that was never crawled is listed too, with nothing made up.
  const elsewhere = page.getByRole('region', { name: /^Elsewhere/ })
  await expect(elsewhere.getByRole('link', { name: 'Open other.example' })).toBeVisible()
  await expect(elsewhere.getByText('Never crawled')).toBeVisible()

  await acme.getByRole('link', { name: 'Open example.com' }).click()
  await expect(page).toHaveURL(new RegExp(`${domain}$`))
})

test('the structure page adds the crawl up by directory and opens each one through the address', async ({
  page,
}) => {
  await page.goto(domain)
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Structure' })
    .click()
  await expect(page).toHaveURL(new RegExp(`${domain}/structure$`))
  await expect(page.getByRole('heading', { name: 'Structure', level: 1 })).toBeVisible()

  const tree = page.getByRole('region', { name: /^Directories/ })
  // The root holds every page, the one that is gone is an error, and /products/ has two pages.
  const root = tree.getByRole('row').filter({ hasText: /^\// }).first()
  await expect(root.getByRole('link', { name: '5', exact: true })).toBeVisible()
  const products = tree.getByRole('row').filter({ hasText: 'products/' })
  await expect(products.getByRole('link', { name: 'products/' })).toBeVisible()

  // A count leads to the URL table, narrowed by the directory's address.
  await products.getByRole('link', { name: '1', exact: true }).first().click()
  await expect(page).toHaveURL(/\/urls\?.*q=example\.com%2Fproducts%2F/)

  // Opening a directory is the address: it can be shared and survives a reload.
  await page.goto(`${domain}/structure?path=/products/`)
  await expect(
    page.getByRole('navigation', { name: 'Directory' }).getByText('products/'),
  ).toBeVisible()
  await page.goto(`${domain}/structure?path=/nothing/`)
  await expect(page.getByText('There are no URLs in this directory.')).toBeVisible()
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
  await page.goto(`${domain}/urls/parameters`)
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
  await page.goto(`${domain}/urls`)
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

test('the Crawls area lists the crawls, with the run actions and its own sections', async ({
  page,
}) => {
  await page.goto(`${domain}/crawls`)
  await expect(page.getByRole('heading', { name: 'Crawls', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run full crawl' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run priority crawl' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Crawl a URL list' })).toBeVisible()

  // The seed crawl: a full one, with its results and findings, and the way to look at it.
  const crawls = page.getByRole('table')
  await expect(crawls.getByText('Full crawl').first()).toBeVisible()
  await expect(crawls.getByText('completed')).toBeVisible()
  await expect(crawls.getByRole('link', { name: 'View', exact: true })).toBeVisible()

  // One entry in the sidebar, and tabs in the page.
  const sidebar = page.getByRole('navigation', { name: 'Main' })
  await expect(sidebar.getByRole('link', { name: 'Crawls' })).toBeVisible()
  const sections = page.getByRole('navigation', { name: 'Crawls sections' })
  await sections.getByRole('link', { name: 'Compare' }).click()
  await expect(page).toHaveURL(/\/crawls\/compare$/)
  await sections.getByRole('link', { name: 'Rechecks' }).click()
  await expect(page).toHaveURL(/\/crawls\/rechecks$/)
  await expect(page.getByText('No rechecks yet.')).toBeVisible()
})

test('a URL list is crawled from a dialog', async ({ page }) => {
  await page.goto(`${domain}/crawls`)
  await page.getByRole('button', { name: 'Crawl a URL list' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('URLs')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Start list crawl' })).toBeVisible()
})

test('the schedules are a section of the settings, and the Crawls page links to them', async ({
  page,
}) => {
  await page.goto(`${domain}/crawls`)
  await page.getByRole('link', { name: 'Set a schedule' }).click()
  await expect(page).toHaveURL(/\/settings\/schedules$/)
  await expect(page.getByRole('heading', { name: 'Schedules', level: 2 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Schedules' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save schedule' })).toHaveCount(2)
})

test('the crawl settings are grouped in sections with one save always in reach', async ({
  page,
}) => {
  await page.goto(`${domain}/settings/crawl`)
  for (const name of ['Requests', 'Scope', 'Extraction', 'Retention', 'Request credentials']) {
    await expect(page.getByRole('group', { name })).toBeVisible()
  }
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeInViewport()
})

test('the addresses of earlier versions still work, and keep their query', async ({ page }) => {
  await page.goto(`${domain}/pages/details?view=redirects`)
  await expect(page).toHaveURL(new RegExp(`${domain}/urls\\?view=redirects$`))
  await expect(page.getByRole('heading', { name: 'URLs', level: 1 })).toBeVisible()

  await page.goto(`${domain}/jobs`)
  await expect(page).toHaveURL(new RegExp(`${domain}/crawls$`))

  await page.goto(`${domain}/pages/history`)
  await expect(page).toHaveURL(new RegExp(`${domain}/crawls$`))

  await page.goto(`${domain}/pages/compare?change=gained`)
  await expect(page).toHaveURL(new RegExp(`${domain}/crawls/compare\\?change=gained$`))

  await page.goto(`${domain}/pages/parameters`)
  await expect(page).toHaveURL(new RegExp(`${domain}/urls/parameters$`))
})

test('the issues panel of the URLs table can be folded, and stays folded', async ({ page }) => {
  await page.goto(`${domain}/urls`)
  const toggle = page.getByRole('button', { name: 'Issues', exact: true }).first()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Issues', exact: true }).first()).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

test('every legacy route preserves query parameters in its redirect', async ({ request }) => {
  for (const [oldPath, newPath] of [
    ['pages', ''],
    ['pages/details', 'urls'],
    ['pages/details/abc', 'urls/abc'],
    ['pages/parameters', 'urls/parameters'],
    ['pages/export/pages', 'urls/export/pages'],
    ['pages/history', 'crawls'],
    ['pages/compare', 'crawls/compare'],
    ['jobs', 'crawls'],
    ['jobs/verifications/abc', 'crawls/rechecks/abc'],
  ]) {
    const query = '?crawl=old&url=abc&issue=noindex&view=redirects'
    const response = await request.get(`${domain}/${oldPath}${query}`, { maxRedirects: 0 })
    expect(response.status()).toBe(307)
    const location = new URL(response.headers().location!, 'http://localhost')
    expect(location.pathname).toBe(`${domain}${newPath ? `/${newPath}` : ''}`)
    expect(location.search).toBe(query)
  }
})

test('the default URL columns fit at 1280 px and selection keeps the table in place', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`${domain}/urls`)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  const rows = page.getByRole('region', {
    name: 'Results table. Scroll to explore rows and columns.',
  })
  const table = rows.getByRole('table')
  await expect(table.getByRole('columnheader', { name: 'Technical state' })).toBeVisible()
  expect(await rows.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const before = await table.boundingBox()
  await page.getByRole('checkbox', { name: 'Select every URL on this page' }).check()
  expect((await table.boundingBox())?.y).toBe(before?.y)
})

test('issues filters stay in the address, with current site findings above them', async ({
  page,
}) => {
  await page.goto(`${domain}/issues`)
  await expect(page.getByRole('heading', { name: 'Site', exact: true })).toBeVisible()
  await expect(
    page.getByText(
      'Current file findings, independent of crawls and excluded from dashboard totals.',
    ),
  ).toBeVisible()
  await page.getByLabel('Type', { exact: true }).selectOption('issue')
  await page.getByLabel('Group', { exact: true }).selectOption('crawling')
  await page.getByLabel('Issue name', { exact: true }).fill('no-such-issue-name')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page).toHaveURL(/type=issue&group=crawling&q=no-such-issue-name/)
  await expect(page.getByLabel('Type', { exact: true })).toHaveValue('issue')
  await expect(page.getByLabel('Group', { exact: true })).toHaveValue('crawling')
  await expect(page.getByLabel('Issue name', { exact: true })).toHaveValue('no-such-issue-name')
  await page.goto(`${domain}/urls?view=errors`)
  await expect(page.getByRole('columnheader', { name: 'Referenced by' })).toBeVisible()
  await page.goto(domain)
  await expect(
    page.getByRole('heading', { name: 'What changed since the previous crawl' }),
  ).toHaveCount(0)
})

test('Core Web Vitals stays hidden without a key and Integrations remains accessible', async ({
  page,
}) => {
  await page.goto(domain)
  await expect(page.getByRole('heading', { name: 'Core Web Vitals', exact: true })).toHaveCount(0)
  await page.goto('/system/integrations')
  await expect(page.getByRole('heading', { name: 'Integrations', level: 1 })).toBeVisible()
  await expect(page.getByLabel('Google API key')).toBeVisible()
})
