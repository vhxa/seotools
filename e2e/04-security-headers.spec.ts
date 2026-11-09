import { expect, test } from './support/test'

test('every page carries the security headers, with a policy made for that response', async ({
  page,
}) => {
  const first = await page.goto('/login')
  const second = await page.goto('/login')
  const headers = (await first!.allHeaders()) as Record<string, string>
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(headers['x-robots-tag']).toBe('noindex, nofollow')
  // Served over plain HTTP here: no HSTS.
  expect(headers['strict-transport-security']).toBeUndefined()

  const policy = headers['content-security-policy'] ?? ''
  expect(policy).toContain("frame-ancestors 'none'")
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1]
  expect(nonce).toBeTruthy()
  const nextPolicy = (await second!.allHeaders())['content-security-policy'] ?? ''
  expect(nextPolicy).not.toContain(`'nonce-${nonce}'`)

  // The page itself still works under the policy: its scripts ran and the form is interactive.
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

test('robots.txt keeps every crawler out, without a session', async ({ request }) => {
  const response = await request.get('/robots.txt')
  expect(response.status()).toBe(200)
  expect(await response.text()).toMatch(/User-Agent: \*\s+Disallow: \//i)
})
