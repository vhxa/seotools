import { expect, test } from './support/test'
import { ADMIN_STATE, HOST } from './support/env'

test.use({ storageState: ADMIN_STATE })

test('a personal favourite opens on home, with overview and all-domains navigation', async ({
  page,
}) => {
  await page.goto('/domains')
  await expect(page.getByRole('heading', { name: 'All domains', level: 1 })).toBeVisible()
  const star = page.getByRole('button', { name: `Set ${HOST} as favourite`, exact: true })
  await star.click()
  await expect(
    page.getByRole('button', { name: `Clear ${HOST} as favourite`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  try {
    await page.goto('/')
    await expect(page).toHaveURL(new RegExp(`/domains/${HOST.replaceAll('.', '\\.')}$`))
    await page.goto(`/domains/${HOST}/urls`)
    await page.getByRole('link', { name: `Overview of ${HOST}`, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/domains/${HOST.replaceAll('.', '\\.')}$`))
    await page.getByRole('button', { name: 'Switch domain' }).click()
    await page.getByRole('menuitem', { name: 'All domains', exact: true }).click()
    await expect(page).toHaveURL(/\/domains$/)
    await expect(page.getByRole('heading', { name: 'All domains', level: 1 })).toBeVisible()
  } finally {
    await page.goto('/domains')
    await page.getByRole('button', { name: `Clear ${HOST} as favourite`, exact: true }).click()
    await expect(
      page.getByRole('button', { name: `Set ${HOST} as favourite`, exact: true }),
    ).toHaveAttribute('aria-pressed', 'false')
  }
})
