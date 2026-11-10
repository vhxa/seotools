import { test as base, expect } from '@playwright/test'

/**
 * `test` for every spec: fails a test when the browser reported a Content-Security-Policy violation
 * on any page it visited, so a new inline script or a resource from elsewhere cannot slip in
 * unnoticed while the policy quietly blocks it. It listens to the `securitypolicyviolation` event,
 * installed before any script of the page runs: a violation that code catches (a probe for `eval`)
 * never reaches the console but is still reported there.
 */
export const test = base.extend<{ policyViolations: string[] }>({
  policyViolations: [
    async ({ page }, use) => {
      const violations: string[] = []
      await page.exposeBinding('__reportPolicyViolation', (_source, violation: string) => {
        violations.push(violation)
      })
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          const report = (window as unknown as { __reportPolicyViolation?: (v: string) => void })
            .__reportPolicyViolation
          report?.(`${event.violatedDirective} blocked ${event.blockedURI} on ${location.pathname}`)
        })
      })
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
