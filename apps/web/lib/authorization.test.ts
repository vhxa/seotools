import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * That no way in misses its check. There is no end-to-end suite, and an action or a route that forgets
 * to authorise itself looks fine in every other test, so this reads the code that does the checking.
 */
const APP = join(__dirname, '..', 'app')
const PROTECTED = join(APP, '(protected)')

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

/** The exported functions of a server action file, with their bodies. */
function exportedFunctions(source: string) {
  return source
    .split(/^export async function /m)
    .slice(1)
    .map((chunk) => ({
      name: chunk.slice(0, chunk.indexOf('(')),
      body: chunk.split(/^}$/m)[0] ?? '',
    }))
}

const actionFiles = filesUnder(APP).filter(
  (path) =>
    /\.tsx?$/.test(path) &&
    !path.endsWith('.test.ts') &&
    readFileSync(path, 'utf8').startsWith("'use server'"),
)
const name = (path: string) => relative(APP, path)

/** Public on purpose: no session exists yet, and each authorises itself some other way. */
const PUBLIC_ACTIONS = new Set(['createAdmin', 'requestPasswordEmailAction', 'setPasswordAction'])
/** Inside a domain and only reading, so anyone who can see the domain may call them. */
const READ_ONLY_DOMAIN_ACTIONS = new Set(['loadLinksAction'])
/** About the person's own account. */
const OWN_ACCOUNT_ACTIONS = new Set(['changePasswordAction', 'saveAlertsAction'])

describe('server actions', () => {
  const inDomain = (path: string) => path.includes(join('domains', '[host]'))

  it('are found', () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(8)
  })

  it.each(actionFiles.map((path) => [name(path), path] as const))('%s authorise', (_, path) => {
    for (const { name: action, body } of exportedFunctions(readFileSync(path, 'utf8'))) {
      if (PUBLIC_ACTIONS.has(action)) continue
      if (OWN_ACCOUNT_ACTIONS.has(action)) {
        // Whoever asks is who it is about; `requireViewer` is `requireSession` with the access.
        expect(body, action).toMatch(/requireSession\(\)|requireViewer\(\)/)
      } else if (READ_ONLY_DOMAIN_ACTIONS.has(action)) {
        expect(body, action).toContain('requireDomain(host)')
      } else if (inDomain(path)) {
        expect(body, `${action} changes a domain`).toContain('requireDomainEditor(host)')
      } else {
        expect(body, `${action} is instance-wide`).toContain('requireAdmin()')
      }
    }
  })
})

describe('pages and routes', () => {
  const all = filesUnder(PROTECTED).filter((path) => /(page\.tsx|route\.ts)$/.test(path))

  it('of a domain start from the domain', () => {
    const inDomain = all.filter((path) => path.includes(join('domains', '[host]')))
    expect(inDomain.length).toBeGreaterThan(10)
    for (const path of inDomain) {
      expect(readFileSync(path, 'utf8'), name(path)).toMatch(/requireDomain(Editor)?\(/)
    }
  })

  it('of the instance are for administrators', () => {
    const instance = all.filter(
      (path) =>
        path.includes(join('(protected)', 'system')) ||
        path.includes(join('domains', 'new')),
    )
    expect(instance.length).toBeGreaterThanOrEqual(5)
    for (const path of instance) {
      expect(readFileSync(path, 'utf8'), name(path)).toContain('requireAdmin()')
    }
  })
})

describe('what a viewer is offered', () => {
  const sources = [...filesUnder(APP), ...filesUnder(join(APP, '..', 'components'))].filter(
    (path) => /\.tsx$/.test(path),
  )
  /** Imports a value (not only a type) from the actions of a domain. */
  const usesDomainActions = (source: string) =>
    /import\s+(?!type\b)[^';]*?from\s+'@\/app\/\(protected\)\/domains\/\[host\]\/(actions|audit-actions|verify-actions|link-actions)'/s.test(
      source,
    )
  /** Reads nothing but values: it does not change the domain, so a viewer may use it. */
  const READ_ONLY = new Set(['components/pages/url-links-panel.tsx'])
  /** Only rendered by what already checks, which is why it does not ask again. */
  const INSIDE_GATED = new Set([
    // Dialogs opened by `UrlAuditActions`, `CreateRuleButton`, `RuleRowActions` and the table's
    // selection menu, none of which exist for a viewer.
    'components/audit/audit-dialog.tsx',
    'components/audit/rule-form.tsx',
  ])
  const candidates = sources.filter((path) => usesDomainActions(readFileSync(path, 'utf8')))
  const relativeToWeb = (path: string) => relative(join(APP, '..'), path)

  it('are found', () => {
    expect(candidates.length).toBeGreaterThanOrEqual(15)
  })

  it.each(candidates.map((path) => [relativeToWeb(path), path] as const))(
    '%s hides or disables what writes',
    (file, path) => {
      if (READ_ONLY.has(file) || INSIDE_GATED.has(file)) return
      // A page knows from `requireDomain`; a component from the context of the domain.
      expect(readFileSync(path, 'utf8'), file).toMatch(/useCanEdit\(|<EditorsOnly>|\bcanEdit\b/)
    },
  )

  it('lists only components that exist', () => {
    for (const file of [...READ_ONLY, ...INSIDE_GATED]) {
      expect(candidates.map(relativeToWeb), file).toContain(file)
    }
  })
})
