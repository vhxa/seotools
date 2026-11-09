import { test as base, expect } from '@playwright/test'

/**
 * `test` for every spec: fails a test when the browser reported a Content-Security-Policy violation
 * on any page it visited, so a new inline script or a resource from elsewhere cannot slip in
 * unnoticed while the policy quietly blocks it.
 */
export const test = base.extend<{ policyViolations: string[] }>({
  policyViolations: [
    async ({ page }, use) => {
      const violations: string[] = []
      page.on('console', (message) => {
        if (/Content Security Policy/i.test(message.text())) violations.push(message.text())
      })
      await use(violations)
      expect(violations, 'Content-Security-Policy violations').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
