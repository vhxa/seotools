import { readFile } from 'node:fs/promises'
import { expect, test } from './support/test'
import { ADMIN, ADMIN_STATE, HOST } from './support/env'
import { signIn } from './support/helpers'

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

test('the crawl settings show the rendering mode, and Rendered is disabled without a ready browser', async ({
  page,
}) => {
  await page.goto(`${domain}/settings/crawl`)
  await expect(page.getByLabel('Page rendering')).toContainText('HTML')
  await expect(page.getByText(/Several times slower/)).toBeVisible()
  await expect(page.getByText(/Rendered mode is unavailable/)).toBeVisible()
  // The options of the Rendered choice are in the page, disabled while HTML is chosen.
  await expect(page.getByRole('spinbutton', { name: 'Render wait limit (ms)' })).toBeDisabled()
  await page.getByLabel('Page rendering').click()
  await expect(page.getByRole('option', { name: 'Rendered' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await page.keyboard.press('Escape')
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
  await expect(
    page.getByRole('heading', { name: 'Browser for JavaScript rendering' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Check now', exact: true })).toBeVisible()
  const testKey = page.getByRole('button', { name: 'Test', exact: true })
  await expect(testKey).toBeDisabled()
  // Saving a key enables the test (never run here: it would ask Google); removing it disables it.
  await page.getByLabel('Google API key').fill('not-a-real-key')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Saved')
  await expect(page.getByText('Key saved', { exact: true })).toBeVisible()
  await expect(testKey).toBeEnabled()
  await page.getByLabel('Remove key').check()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(testKey).toBeDisabled()
})

test('ignored parameter settings persist and explain next-crawl behavior', async ({ page }) => {
  await page.goto(`${domain}/settings/crawl`)
  const names = page.getByLabel('Ignored query parameters', { exact: true })
  await names.fill('updatedAt\nutm_*')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('status')).toBeVisible()
  await page.reload()
  await expect(names).toHaveValue('updatedAt\nutm_*')
  await expect(page.getByText(/Applies from the next crawl, only to internal URLs/)).toBeVisible()
  await page.goto(`${domain}/urls/parameters`)
  const ignoredRow = page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: 'updatedAt', exact: true }) })
  await expect(
    ignoredRow.getByRole('button', {
      name: 'Stop ignoring (including matching prefixes)',
      exact: true,
    }),
  ).toBeVisible()
  await ignoredRow
    .getByRole('button', { name: 'Stop ignoring (including matching prefixes)', exact: true })
    .click()
  await expect(ignoredRow).toHaveCount(0)
  await page.goto(`${domain}/settings/crawl`)
  await expect(names).toHaveValue('utm_*')
  await names.fill('')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('status')).toBeVisible()
})

test('the robots page starts an explicit bot access test with its limitations visible', async ({
  page,
}) => {
  await page.goto(`${domain}/crawl-files/robots`)
  await expect(page.getByText('Bot access test', { exact: true })).toBeVisible()
  await expect(page.getByText(/not whether a real bot is blocked/)).toBeVisible()
  await expect(page.getByText('robots.txt token only, nothing to test')).toHaveCount(2)
  await page.getByRole('button', { name: 'Test bot access', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Testing bot access…' })).toBeDisabled()
  await expect(page.getByText(/· Queued/)).toBeVisible()
})

test('the language chosen on the account is kept across sign-ins, and the name can be edited', async ({
  page,
  browser,
}) => {
  await page.goto('/account')
  await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible()
  await page.getByLabel('Your name').fill('   ')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '1 to 100 characters' })).toBeVisible()
  await page.getByLabel('Your name').fill(`${ADMIN.name} II`)
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByText('Your name is saved.')).toBeVisible()
  await page.getByLabel('Your name').fill(ADMIN.name)
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByText('Your name is saved.')).toBeVisible()

  await page.getByRole('radio', { name: 'Español' }).click()
  await page.getByRole('button', { name: 'Save language' }).click()
  try {
    await expect(page.getByRole('heading', { name: 'Cuenta', level: 1 })).toBeVisible()
    // A fresh browser with no cookie: the saved language comes back when signing in.
    const fresh = await browser.newContext({
      locale: 'en-US',
      storageState: { cookies: [], origins: [] },
    })
    try {
      const other = await fresh.newPage()
      await signIn(other, ADMIN)
      await other.goto('/account')
      await expect(other.getByRole('heading', { name: 'Cuenta', level: 1 })).toBeVisible()
    } finally {
      await fresh.close()
    }
  } finally {
    await page.goto('/account')
    await page.getByRole('radio', { name: 'Según el navegador' }).click()
    await page.getByRole('button', { name: 'Guardar idioma' }).click()
    await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible()
  }
})

test('an editor dismisses a finding and sees its saved state while recompute waits', async ({
  page,
}) => {
  await page.goto(`${domain}/issues`)
  const row = page.getByRole('link', { name: /Client error 4xx \(internal\)/ }).locator('..')
  await row.getByRole('button', { name: 'Finding actions' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Note (optional)' }).fill('Known obsolete route')
  page.once('dialog', (confirmation) => confirmation.accept())
  await dialog.getByRole('button', { name: 'Dismiss across the domain' }).click()
  await expect(dialog.getByRole('status')).toContainText('Saved')
  await page.goto(`${domain}/settings/audit?tab=dismissed`)
  await expect(page.getByRole('tab', { name: 'Dismissed', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByText(/Dismissed by Ada Admin/)).toBeVisible()
  await expect(page.getByText('Note: Known obsolete route', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Restore to pending' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Restore to pending' }).click()
  await expect(page.getByText('No saved finding states.')).toBeVisible()
  await expect(page.getByText('Known obsolete route')).toHaveCount(0)
})

test('a rule starts from a template, is saved with its paths, and shows in the list in plain words', async ({
  page,
}) => {
  // With language directories declared, a new rule covers them by default.
  await page.goto(`${domain}/settings/audit?tab=languages`)
  await page.getByRole('textbox', { name: 'Directories', exact: true }).fill('/es\n/en')
  await page.getByRole('button', { name: 'Save directories' }).click()
  await expect(page.getByText(/^Saved/).first()).toBeVisible()

  await page.goto(`${domain}/settings/audit`)
  await page.getByRole('button', { name: 'Create rule' }).click()
  const dialog = page.getByRole('dialog')
  const language = dialog.getByRole('switch', { name: 'Also in each language' })
  await expect(language).toBeChecked()
  /** A condition is a row of its own: two buttons, "don't warn either way", and the way back. */
  const row = (name: string) =>
    dialog.locator('[data-statement]').filter({ has: page.getByRole('radiogroup', { name }) })
  const dontWarn = (name: string) =>
    row(name).getByRole('checkbox', { name: 'Don’t warn either way' })

  await dialog.getByRole('combobox', { name: 'Start from a template (optional)' }).click()
  await page.getByRole('option', { name: /Private area/ }).click()
  // The template only fills the form, and leaves the languages as they were.
  await expect(language).toBeChecked()
  await expect(row('Listed in a sitemap').getByRole('radio', { name: 'Forbidden' })).toBeChecked()
  await expect(dontWarn('Noindex')).toBeChecked()
  await expect(row('Noindex').getByRole('radio', { checked: true })).toHaveCount(0)

  // One that is not stated shows what applies, without choosing it.
  const unlinked = row('No internal links')
  await expect(unlinked.getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(dontWarn('No internal links')).not.toBeChecked()
  await dontWarn('No internal links').click()
  await expect(dontWarn('No internal links')).toBeChecked()
  // Choosing a button states that and unchecks "don't warn".
  await unlinked.getByRole('radio', { name: 'Forbidden' }).click()
  await expect(unlinked.getByRole('radio', { name: 'Forbidden' })).toBeChecked()
  await expect(dontWarn('No internal links')).not.toBeChecked()
  // And the way back returns it to not stated.
  await unlinked.getByRole('button', { name: 'Back to inherited' }).click()
  await expect(unlinked.getByRole('radio', { checked: true })).toHaveCount(0)

  await dialog.getByRole('textbox', { name: 'Path 1' }).fill('/private')
  await dialog.getByRole('button', { name: 'Add path' }).click()
  await dialog.getByRole('textbox', { name: 'Path 2' }).fill('/account')
  await dialog.getByRole('button', { name: 'Save rule' }).click()
  await expect(dialog).toHaveCount(0)

  const listed = page.getByRole('row').filter({ hasText: '/private' })
  await expect(listed.getByText('and 1 more')).toBeVisible()
  await expect(listed.getByText(/not indexable · noindex indifferent/)).toBeVisible()
  await expect(listed.getByText(/not in a sitemap/)).toBeVisible()
})
