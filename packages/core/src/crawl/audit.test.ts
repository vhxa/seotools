import { describe, expect, it } from 'vitest'
import {
  AUDIT_LIMITS,
  AUDIT_SEMANTICS,
  EMPTY_AUDIT_SNAPSHOT,
  LANGUAGE_LIMITS,
  NO_LANGUAGES,
  auditSnapshotOf,
  auditResultsState,
  canonicalLanguages,
  compileAuditRules,
  compileAuditSnapshot,
  defaultResolution,
  intentOutcome,
  normalizeLanguagePrefix,
  parseAuditReason,
  parseAuditSelector,
  parseAuditSnapshot,
  parseLanguagePrefixes,
  sameLanguages,
  selectorKey,
  selectorMatches,
  semanticsOf,
  serializeAuditSnapshot,
  urlPartsOf,
  type AuditRule,
  type AuditSelector,
  type IndexIntent,
  type LanguageConfig,
  type QuerySelector,
  type RecordedIntent,
  type SelectorScope,
} from './audit'

const HOST = 'example.com'
const ANY: QuerySelector = { mode: 'any' }
const exact = (value: string): QuerySelector => ({ mode: 'exact', value })

let counter = 0
const audit = (
  selector: AuditSelector,
  value: 'exclude' | 'include' = 'exclude',
  extra: Partial<AuditRule> = {},
): AuditRule =>
  ({
    id: `r${String(++counter).padStart(3, '0')}`,
    dimension: 'audit',
    value,
    selector,
    reason: null,
    enabled: true,
    ...extra,
  }) as AuditRule
const intent = (
  selector: AuditSelector,
  value: RecordedIntent,
  extra: Partial<AuditRule> & { acceptNofollow?: boolean } = {},
): AuditRule =>
  ({
    id: `r${String(++counter).padStart(3, '0')}`,
    dimension: 'intent',
    value,
    selector,
    reason: null,
    enabled: true,
    acceptNofollow: false,
    ...extra,
  }) as AuditRule
const prefix = (
  path: string,
  query: QuerySelector = ANY,
  scope: SelectorScope = 'literal',
): AuditSelector => ({ kind: 'prefix', path, query, scope })
const path = (
  value: string,
  query: QuerySelector = ANY,
  scope: SelectorScope = 'literal',
): AuditSelector => ({ kind: 'path', path: value, query, scope })
const shared = (value: string, query: QuerySelector = ANY) => path(value, query, 'shared')
const sharedPrefix = (value: string, query: QuerySelector = ANY) => prefix(value, query, 'shared')
const url = (value: string): AuditSelector => ({ kind: 'url', url: value })

/** Three languages with a directory, and a default language that has none. */
const LANGUAGES: LanguageConfig = { prefixes: ['/ca', '/en', '/es'], unprefixed: true }

const matches = (selector: AuditSelector, target: string, languages = NO_LANGUAGES) => {
  const parts = urlPartsOf(target, HOST, languages)
  return parts !== null && selectorMatches(selector, parts)
}

const parse = (input: Parameters<typeof parseAuditSelector>[0]) => parseAuditSelector(input, HOST)

describe('parseAuditSelector', () => {
  describe('an exact URL', () => {
    it('is normalized like the crawler does, keeping what tells two URLs apart', () => {
      expect(parse({ kind: 'url', value: 'HTTPS://Example.COM:443/Cart?b=1&a=2#top' })).toEqual({
        ok: true,
        selector: url('https://example.com/Cart?b=1&a=2'),
      })
      expect(parse({ kind: 'url', value: 'http://www.example.com/cart/' })).toEqual({
        ok: true,
        selector: url('http://www.example.com/cart/'),
      })
    })

    it('takes a bare path or host for HTTPS on the domain', () => {
      expect(parse({ kind: 'url', value: '/cart' })).toEqual({
        ok: true,
        selector: url('https://example.com/cart'),
      })
      expect(parse({ kind: 'url', value: 'www.example.com/cart' })).toEqual({
        ok: true,
        selector: url('https://www.example.com/cart'),
      })
    })

    it('refuses what is not a URL, and what is not on the domain', () => {
      expect(parse({ kind: 'url', value: '' })).toEqual({ ok: false, error: 'url' })
      expect(parse({ kind: 'url', value: 'javascript:alert(1)' })).toEqual({
        ok: false,
        error: 'url',
      })
      expect(parse({ kind: 'url', value: 'https://user:pw@example.com/' })).toEqual({
        ok: false,
        error: 'url',
      })
      for (const external of [
        'https://other.com/cart',
        'https://shop.example.com/cart',
        'https://example.com:8443/cart',
      ]) {
        expect(parse({ kind: 'url', value: external })).toEqual({ ok: false, error: 'external' })
      }
    })
  })

  describe('a path', () => {
    it('keeps its case and trailing slash, and percent-encodes like the crawler', () => {
      expect(parse({ kind: 'path', value: '/Mi Cuenta/', query: 'any' })).toEqual({
        ok: true,
        selector: path('/Mi%20Cuenta/'),
      })
      expect(parse({ kind: 'path', value: '/café', query: 'any' })).toEqual({
        ok: true,
        selector: path('/caf%C3%A9'),
      })
    })

    it('does not decode a separator', () => {
      expect(parse({ kind: 'path', value: '/a%2Fb', query: 'any' })).toEqual({
        ok: true,
        selector: path('/a%2Fb'),
      })
    })

    it('drops the trailing slash of a prefix, so /cuenta and /cuenta/ are the same prefix', () => {
      expect(parse({ kind: 'prefix', value: '/cuenta/', query: 'any' })).toEqual({
        ok: true,
        selector: prefix('/cuenta'),
      })
      expect(parse({ kind: 'prefix', value: '/', query: 'any' })).toEqual({
        ok: true,
        selector: prefix('/'),
      })
    })

    it.each([
      ['', 'no slash'],
      ['cuenta', 'no leading slash'],
      ['/a?b=1', 'a query'],
      ['/a#top', 'a fragment'],
      ['/a\\b', 'a backslash'],
      ['/a\u0000b', 'a control character'],
      [`/${'a'.repeat(AUDIT_LIMITS.selector)}`, 'too long'],
    ])('refuses %j (%s)', (value) => {
      expect(parse({ kind: 'path', value, query: 'any' })).toEqual({ ok: false, error: 'path' })
    })
  })

  describe('a query', () => {
    it('is kept in the order and repetition it was written in', () => {
      expect(
        parse({ kind: 'path', value: '/p', query: 'exact', queryValue: '?b=1&a=2&a=2' }),
      ).toEqual({
        ok: true,
        selector: path('/p', exact('b=1&a=2&a=2')),
      })
    })

    it('can be empty', () => {
      for (const queryValue of ['', '?', undefined]) {
        expect(parse({ kind: 'path', value: '/p', query: 'exact', queryValue })).toEqual({
          ok: true,
          selector: path('/p', exact('')),
        })
      }
    })

    it('is ignored unless asked for', () => {
      expect(parse({ kind: 'path', value: '/p', query: 'any', queryValue: 'x=1' })).toEqual({
        ok: true,
        selector: path('/p'),
      })
    })

    it('is percent-encoded like the crawler does, and cannot hold a fragment', () => {
      expect(parse({ kind: 'path', value: '/p', query: 'exact', queryValue: 'q=a b' })).toEqual({
        ok: true,
        selector: path('/p', exact('q=a%20b')),
      })
      expect(parse({ kind: 'path', value: '/p', query: 'exact', queryValue: 'a=1#x' })).toEqual({
        ok: false,
        error: 'query',
      })
    })
  })
})

describe('parseAuditReason', () => {
  it('trims, and turns nothing into null', () => {
    expect(parseAuditReason('  Cart  ')).toBe('Cart')
    expect(parseAuditReason('   ')).toBeNull()
    expect(parseAuditReason(null)).toBeNull()
  })

  it('refuses a reason that is too long', () => {
    expect(parseAuditReason('x'.repeat(AUDIT_LIMITS.reason))).toHaveLength(AUDIT_LIMITS.reason)
    expect(parseAuditReason('x'.repeat(AUDIT_LIMITS.reason + 1))).toBeUndefined()
  })
})

describe('what a selector covers', () => {
  it('matches an exact URL with its scheme, host, path and query', () => {
    const selector = url('https://example.com/cart?x=1')
    expect(matches(selector, 'https://example.com/cart?x=1')).toBe(true)
    expect(matches(selector, 'http://example.com/cart?x=1')).toBe(false)
    expect(matches(selector, 'https://www.example.com/cart?x=1')).toBe(false)
    expect(matches(selector, 'https://example.com/cart/?x=1')).toBe(false)
    expect(matches(selector, 'https://example.com/Cart?x=1')).toBe(false)
    expect(matches(selector, 'https://example.com/cart')).toBe(false)
    expect(matches(selector, 'https://example.com/cart?x=1&y=2')).toBe(false)
  })

  it('applies path rules to the host, its www variant and both schemes, on default ports only', () => {
    const selector = path('/cart')
    for (const covered of [
      'https://example.com/cart',
      'http://example.com/cart',
      'https://www.example.com/cart',
      'http://www.example.com/cart',
      'https://example.com:443/cart',
    ]) {
      expect(matches(selector, covered)).toBe(true)
    }
    for (const out of [
      'https://shop.example.com/cart',
      'https://other.com/cart',
      'https://example.com:8443/cart',
      'https://notexample.com/cart',
    ]) {
      expect(matches(selector, out)).toBe(false)
    }
  })

  describe('an exact path', () => {
    it('is that path and no other', () => {
      const selector = path('/cuenta')
      expect(matches(selector, 'https://example.com/cuenta')).toBe(true)
      expect(matches(selector, 'https://example.com/cuenta/')).toBe(false)
      expect(matches(selector, 'https://example.com/cuenta/pedidos')).toBe(false)
      expect(matches(selector, 'https://example.com/cuentame')).toBe(false)
    })

    it('keeps the case of the path', () => {
      expect(matches(path('/Cuenta'), 'https://example.com/cuenta')).toBe(false)
      expect(matches(path('/Cuenta'), 'https://example.com/Cuenta')).toBe(true)
    })

    it('does not decode separators, so %2F is not a slash', () => {
      expect(matches(path('/a/b'), 'https://example.com/a%2Fb')).toBe(false)
      expect(matches(path('/a%2Fb'), 'https://example.com/a%2Fb')).toBe(true)
      expect(matches(prefix('/a'), 'https://example.com/a%2Fb')).toBe(false)
    })
  })

  describe('a prefix', () => {
    it('covers its path and what is below it by segments', () => {
      const selector = prefix('/cuenta')
      for (const covered of ['/cuenta', '/cuenta/', '/cuenta/pedidos', '/cuenta/pedidos/12']) {
        expect(matches(selector, `https://example.com${covered}`)).toBe(true)
      }
      for (const out of ['/cuentame', '/cuenta-nueva', '/otra/cuenta', '/']) {
        expect(matches(selector, `https://example.com${out}`)).toBe(false)
      }
    })

    it('covers the whole site from the root', () => {
      expect(matches(prefix('/'), 'https://example.com/')).toBe(true)
      expect(matches(prefix('/'), 'https://example.com/a/b?c=1')).toBe(true)
      expect(matches(prefix('/'), 'https://other.com/')).toBe(false)
    })

    it('keeps the case of the path', () => {
      expect(matches(prefix('/Cuenta'), 'https://example.com/cuenta/x')).toBe(false)
    })
  })

  describe('the query of a path rule', () => {
    it('is ignored unless asked for', () => {
      const selector = prefix('/search')
      expect(matches(selector, 'https://example.com/search')).toBe(true)
      expect(matches(selector, 'https://example.com/search?q=a&page=2')).toBe(true)
    })

    it('can be one in particular', () => {
      const selector = path('/search', exact('q=a&page=2'))
      expect(matches(selector, 'https://example.com/search?q=a&page=2')).toBe(true)
      expect(matches(selector, 'https://example.com/search?q=a')).toBe(false)
      expect(matches(selector, 'https://example.com/search')).toBe(false)
    })

    it('can be none at all', () => {
      const selector = path('/search', exact(''))
      expect(matches(selector, 'https://example.com/search')).toBe(true)
      expect(matches(selector, 'https://example.com/search?q=a')).toBe(false)
    })

    it('does not treat reordered or repeated parameters as the same query', () => {
      const selector = path('/s', exact('a=1&b=2'))
      expect(matches(selector, 'https://example.com/s?a=1&b=2')).toBe(true)
      expect(matches(selector, 'https://example.com/s?b=2&a=1')).toBe(false)
      expect(matches(selector, 'https://example.com/s?a=1&b=2&a=1')).toBe(false)
      expect(matches(selector, 'https://example.com/s?a=1&&b=2')).toBe(false)
    })

    it('compares the query the way the crawler stores it', () => {
      const parsed = parse({ kind: 'path', value: '/s', query: 'exact', queryValue: 'q=a b' })
      expect(parsed.ok && matches(parsed.selector, 'https://example.com/s?q=a b')).toBe(true)
      expect(parsed.ok && matches(parsed.selector, 'https://example.com/s?q=a+b')).toBe(false)
    })
  })

  it('names a selector by what makes it different from another', () => {
    expect(selectorKey(path('/a'))).not.toBe(selectorKey(path('/a', exact(''))))
    expect(selectorKey(path('/a'))).not.toBe(selectorKey(prefix('/a')))
    expect(selectorKey(path('/a', exact('x=1')))).not.toBe(selectorKey(path('/a', exact('x=2'))))
    expect(selectorKey(prefix('/a'))).toBe(selectorKey(prefix('/a')))
  })
})

describe('resolving a URL', () => {
  const resolve = (rules: AuditRule[], target: string, languages = NO_LANGUAGES) =>
    compileAuditRules(rules, HOST, { languages }).resolve(target)
  const auditOf = (rules: AuditRule[], target: string) => resolve(rules, target).audit
  const intentOf = (rules: AuditRule[], target: string) => resolve(rules, target).intent

  it('audits everything and expects it to be indexable when there are no rules', () => {
    expect(resolve([], 'https://example.com/cart')).toEqual({
      audit: { value: 'audited', rule: null },
      intent: { value: 'indexable', rule: null, acceptNofollow: false },
    })
  })

  it('names the rule that decided each dimension', () => {
    const exclusion = audit(prefix('/cart'), 'exclude', { reason: 'The cart' })
    const expectation = intent(prefix('/cart'), 'not-indexable')
    const found = resolve([exclusion, expectation], 'https://example.com/cart/items')
    expect(found.audit).toEqual({ value: 'excluded', rule: exclusion })
    expect(found.intent).toEqual({
      value: 'not-indexable',
      rule: expectation,
      acceptNofollow: false,
    })
  })

  it('resolves each dimension on its own', () => {
    const rules = [audit(prefix('/cart')), intent(path('/cart/help'), 'indexable')]
    expect(auditOf(rules, 'https://example.com/cart/help').value).toBe('excluded')
    expect(intentOf(rules, 'https://example.com/cart/help').value).toBe('indexable')
    // Nothing covers it, so it is expected to be what everything is.
    expect(intentOf(rules, 'https://example.com/cart/other')).toMatchObject({
      value: 'indexable',
      rule: null,
    })
  })

  describe('precedence', () => {
    it('puts an exact URL before an exact path before a prefix', () => {
      const byPrefix = audit(prefix('/cart/items'), 'exclude')
      const byPath = audit(path('/cart/items'), 'include')
      const byUrl = audit(url('https://example.com/cart/items'), 'exclude')
      const target = 'https://example.com/cart/items'
      expect(auditOf([byPrefix], target).rule).toBe(byPrefix)
      expect(auditOf([byPrefix, byPath], target).rule).toBe(byPath)
      expect(auditOf([byPath, byPrefix, byUrl], target).rule).toBe(byUrl)
    })

    it('puts an exact path before a longer prefix', () => {
      const byPath = audit(path('/a'), 'include')
      const byPrefix = audit(prefix('/a'), 'exclude')
      expect(auditOf([byPrefix, byPath], 'https://example.com/a').rule).toBe(byPath)
      expect(auditOf([byPrefix, byPath], 'https://example.com/a/b').rule).toBe(byPrefix)
    })

    it('puts the longest prefix first', () => {
      const wide = audit(prefix('/shop'), 'exclude')
      const narrow = audit(prefix('/shop/help'), 'include')
      const rules = [wide, narrow]
      expect(auditOf(rules, 'https://example.com/shop/help/faq').rule).toBe(narrow)
      expect(auditOf(rules, 'https://example.com/shop/help').rule).toBe(narrow)
      expect(auditOf(rules, 'https://example.com/shop/cart').rule).toBe(wide)
      expect(auditOf(rules, 'https://example.com/shop/helpdesk').rule).toBe(wide)
    })

    it('puts a query that is asked for before one that is ignored, for the same path', () => {
      const ignoring = audit(path('/search'), 'exclude')
      const asking = audit(path('/search', exact('page=2')), 'include')
      const rules = [ignoring, asking]
      expect(auditOf(rules, 'https://example.com/search?page=2').rule).toBe(asking)
      expect(auditOf(rules, 'https://example.com/search?page=3').rule).toBe(ignoring)
      expect(auditOf(rules, 'https://example.com/search').rule).toBe(ignoring)

      const wide = audit(prefix('/search'), 'exclude')
      const specific = audit(prefix('/search', exact('')), 'include')
      expect(auditOf([wide, specific], 'https://example.com/search/x').rule).toBe(specific)
      expect(auditOf([wide, specific], 'https://example.com/search/x?q=1').rule).toBe(wide)
    })

    it('falls back to a broader prefix when the query of a narrower one does not match', () => {
      const wide = audit(prefix('/a'), 'exclude')
      const narrow = audit(prefix('/a/b', exact('x=1')), 'include')
      expect(auditOf([wide, narrow], 'https://example.com/a/b/c?x=1').rule).toBe(narrow)
      expect(auditOf([wide, narrow], 'https://example.com/a/b/c?x=2').rule).toBe(wide)
    })

    it('does not depend on the order the rules come in', () => {
      const rules = [
        audit(prefix('/a'), 'exclude'),
        audit(prefix('/a/b'), 'include'),
        audit(path('/a/b/c'), 'exclude'),
        audit(url('https://example.com/a/b/c?x=1'), 'include'),
        audit(path('/a/b/c', exact('x=1')), 'exclude'),
      ]
      const targets = [
        'https://example.com/a',
        'https://example.com/a/b',
        'https://example.com/a/b/c',
        'https://example.com/a/b/c?x=1',
        'https://example.com/a/b/c?x=2',
        'https://example.com/a/b/c/d',
      ]
      const expected = targets.map((target) => auditOf(rules, target).rule?.id)
      for (let shuffle = 0; shuffle < 10; shuffle++) {
        const shuffled = [...rules].sort(() => Math.random() - 0.5)
        expect(targets.map((target) => auditOf(shuffled, target).rule?.id)).toEqual(expected)
      }
    })

    it('breaks a tie between rules with the same selector by their id', () => {
      const low = audit(prefix('/a'), 'exclude', { id: 'a-1' })
      const high = audit(prefix('/a'), 'include', { id: 'a-2' })
      expect(auditOf([high, low], 'https://example.com/a').rule).toBe(low)
      expect(auditOf([low, high], 'https://example.com/a').rule).toBe(low)
    })
  })

  describe('an exception', () => {
    it('includes a URL a rule would exclude, and goes back to the rule without it', () => {
      const exclusion = audit(prefix('/cart'), 'exclude')
      const exception = audit(url('https://example.com/cart/help'), 'include')
      expect(auditOf([exclusion, exception], 'https://example.com/cart/help')).toEqual({
        value: 'audited',
        rule: exception,
      })
      expect(auditOf([exclusion, exception], 'https://example.com/cart/other').value).toBe(
        'excluded',
      )
      expect(auditOf([exclusion], 'https://example.com/cart/help')).toEqual({
        value: 'excluded',
        rule: exclusion,
      })
    })

    it('can expect the opposite of a broader rule, for one URL', () => {
      const broad = intent(prefix('/blog'), 'not-indexable')
      const exception = intent(url('https://example.com/blog/post'), 'indexable')
      expect(intentOf([broad, exception], 'https://example.com/blog/post')).toMatchObject({
        value: 'indexable',
        rule: exception,
      })
      expect(intentOf([broad, exception], 'https://example.com/blog/draft').value).toBe(
        'not-indexable',
      )
      // Without the exception, the URL is back to what the rule says.
      expect(intentOf([broad], 'https://example.com/blog/post').value).toBe('not-indexable')
    })

    it('applies to one URL, not to the same path under another scheme or host', () => {
      const exclusion = audit(prefix('/cart'), 'exclude')
      const exception = audit(url('https://example.com/cart/help'), 'include')
      expect(auditOf([exclusion, exception], 'http://example.com/cart/help').value).toBe('excluded')
      expect(auditOf([exclusion, exception], 'https://www.example.com/cart/help').value).toBe(
        'excluded',
      )
    })
  })

  it('ignores the rules that are off', () => {
    const off = audit(prefix('/cart'), 'exclude', { enabled: false })
    expect(auditOf([off], 'https://example.com/cart').rule).toBeNull()
    const compiled = compileAuditRules([off], HOST)
    expect(compiled.covering('https://example.com/cart')).toEqual([])
  })

  it('leaves URLs outside the domain at the default', () => {
    const rules = [audit(prefix('/'), 'exclude'), intent(prefix('/'), 'indexable')]
    for (const external of [
      'https://other.com/a',
      'https://blog.example.com/a',
      'https://example.com:8080/a',
    ]) {
      expect(resolve(rules, external)).toEqual(defaultResolution())
    }
  })

  it('lists the rules that cover a URL, the one that decides first', () => {
    const wide = audit(prefix('/a'), 'exclude')
    const narrow = audit(prefix('/a/b'), 'include')
    const exact = audit(url('https://example.com/a/b/c'), 'exclude')
    const other = intent(prefix('/a'), 'indexable')
    const compiled = compileAuditRules([wide, other, narrow, exact], HOST)
    expect(compiled.covering('https://example.com/a/b/c').map((rule) => rule.id)).toEqual([
      exact.id,
      narrow.id,
      wide.id,
      other.id,
    ])
    expect(compiled.covering('https://example.com/a/b/c')[0]).toBe(exact)
  })

  it('agrees with the plain definition of what a selector covers, whatever the rules', () => {
    const paths = [
      '/',
      '/a',
      '/a/',
      '/a/b',
      '/a/b/',
      '/a/b/c',
      '/ab',
      '/A',
      '/a%2Fb',
      '/a//b',
      '/es',
      '/es/a',
      '/es/a/b',
      '/en/a/b/c',
      '/fr/a',
    ]
    const queries = ['', '?x=1', '?x=1&y=2', '?y=2&x=1', '?x=2']
    const hosts = ['https://example.com', 'http://www.example.com']
    const targets = hosts.flatMap((origin) =>
      paths.flatMap((p) => queries.map((q) => `${origin}${p}${q}`)),
    )
    const rng = (() => {
      let state = 12345
      return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 2 ** 32
      }
    })()
    const pick = <T>(items: readonly T[]) => items[Math.floor(rng() * items.length)]!
    const queryChoices: QuerySelector[] = [ANY, ANY, exact(''), exact('x=1'), exact('x=1&y=2')]
    const selectorPaths = ['/', '/a', '/a/b', '/ab', '/A', '/a/b/c']

    for (let round = 0; round < 40; round++) {
      const rules: AuditRule[] = []
      const seen = new Set<string>()
      for (let i = 0; i < 8; i++) {
        const kind = pick(['url', 'path', 'prefix'] as const)
        const selector: AuditSelector =
          kind === 'url'
            ? url(`${pick(hosts)}${pick(paths)}${pick(queries)}`)
            : {
                kind,
                path: pick(selectorPaths),
                query: pick(queryChoices),
                scope: pick(['literal', 'literal', 'shared'] as const),
              }
        const key = selectorKey(selector)
        // Enabled rules of one dimension never share a selector: that is what the store enforces.
        if (seen.has(key)) continue
        seen.add(key)
        rules.push(audit(selector, pick(['exclude', 'include'] as const)))
      }
      for (const languages of [NO_LANGUAGES, LANGUAGES, { ...LANGUAGES, unprefixed: false }]) {
        const compiled = compileAuditRules(rules, HOST, { languages })
        for (const target of targets) {
          const direct = compiled.covering(target)[0] ?? null
          expect(compiled.resolve(target).audit.rule?.id ?? null).toBe(direct?.id ?? null)
        }
      }
    }
  })
})

describe('the configuration an analysis used', () => {
  const rules = [
    audit(prefix('/cart'), 'exclude', { reason: 'The cart' }),
    intent(path('/blog', exact('')), 'indexable'),
    audit(prefix('/old'), 'exclude', { enabled: false }),
  ]

  it('keeps the enabled rules, sorted, with the version', () => {
    const snapshot = auditSnapshotOf(7, [...rules].reverse())
    expect(snapshot.version).toBe(7)
    expect(snapshot.rules.map((rule) => rule.id)).toEqual([rules[0]!.id, rules[1]!.id])
  })

  it('round-trips, and resolves the same afterwards', () => {
    const snapshot = auditSnapshotOf(3, rules)
    const restored = parseAuditSnapshot(serializeAuditSnapshot(snapshot))
    expect(restored).toEqual(snapshot)
    expect(
      compileAuditSnapshot(restored!, HOST).resolve('https://example.com/cart').audit.value,
    ).toBe('excluded')
  })

  it.each([null, '', 'not json', '{}', '{"version":-1,"rules":[]}', '{"version":1,"rules":[{}]}'])(
    'does not take %j for a snapshot',
    (raw) => {
      expect(parseAuditSnapshot(raw)).toBeNull()
    },
  )
})

describe('intentOutcome', () => {
  it('has nothing to compare when nothing was declared', () => {
    for (const state of ['indexable', 'not-indexable', 'unknown'] as const) {
      expect(intentOutcome('none', state)).toBe('none')
    }
  })

  it('meets or misses an expectation of being indexable', () => {
    expect(intentOutcome('indexable', 'indexable')).toBe('met')
    expect(intentOutcome('indexable', 'not-indexable', ['noindex'])).toBe('unmet')
  })

  it('meets or misses an expectation of not being indexable', () => {
    expect(intentOutcome('not-indexable', 'not-indexable', ['noindex'])).toBe('met')
    expect(intentOutcome('not-indexable', 'not-indexable', ['canonical', 'robots'])).toBe('met')
    expect(intentOutcome('not-indexable', 'indexable')).toBe('unmet')
  })

  it('does not take a robots.txt block alone for proof of being out of the index', () => {
    expect(intentOutcome('not-indexable', 'not-indexable', ['robots'])).toBe('robots-only')
  })

  it('never reads missing data as an expectation met', () => {
    expect(intentOutcome('indexable', 'unknown')).toBe('unknown')
    expect(intentOutcome('not-indexable', 'unknown')).toBe('unknown')
  })
})

describe('auditResultsState', () => {
  const quiet = { version: 0, recomputeError: null }
  const analysed = (auditVersion: number | null) => ({ pagesByWorstIssue: {}, auditVersion })

  it('has nothing without a crawl, and says when a crawl was never analysed', () => {
    expect(auditResultsState(null, quiet)).toEqual({ kind: 'none' })
    expect(auditResultsState({ pagesByWorstIssue: null, auditVersion: null }, quiet)).toEqual({
      kind: 'unanalysed',
    })
  })

  it('takes a crawl analysed before configuration existed for version 0', () => {
    expect(auditResultsState(analysed(null), quiet)).toEqual({ kind: 'current' })
    expect(auditResultsState(analysed(0), quiet)).toEqual({ kind: 'current' })
  })

  it('is current with the same version or a later one, and pending behind it', () => {
    expect(auditResultsState(analysed(3), { version: 3, recomputeError: null })).toEqual({
      kind: 'current',
    })
    expect(auditResultsState(analysed(4), { version: 3, recomputeError: null })).toEqual({
      kind: 'current',
    })
    expect(auditResultsState(analysed(2), { version: 3, recomputeError: null })).toEqual({
      kind: 'pending',
    })
    expect(auditResultsState(analysed(null), { version: 1, recomputeError: null })).toEqual({
      kind: 'pending',
    })
  })

  it('is pending even for a crawl that was never analysed, once rules exist', () => {
    expect(
      auditResultsState(
        { pagesByWorstIssue: null, auditVersion: null },
        { version: 1, recomputeError: null },
      ),
    ).toEqual({ kind: 'pending' })
  })

  it('says the recalculation failed, only while the results are behind', () => {
    const error = { message: 'boom' }
    expect(auditResultsState(analysed(1), { version: 2, recomputeError: error })).toEqual({
      kind: 'failed',
      message: 'boom',
    })
    expect(auditResultsState(analysed(2), { version: 2, recomputeError: error })).toEqual({
      kind: 'current',
    })
  })
})

describe('language directories', () => {
  it('normalizes a directory to one segment with a leading slash and no trailing one', () => {
    expect(normalizeLanguagePrefix('es')).toBe('/es')
    expect(normalizeLanguagePrefix('/es/')).toBe('/es')
    expect(normalizeLanguagePrefix(' /pt-br ')).toBe('/pt-br')
    expect(normalizeLanguagePrefix('zh_Hant')).toBe('/zh_Hant')
  })

  it.each(['', '/', '//', '/es/ar', '/es?x', '/e s', '/é', '/es#', `/${'a'.repeat(33)}`])(
    'refuses %j',
    (value) => {
      expect(normalizeLanguagePrefix(value)).toBeNull()
    },
  )

  it('reads a list written with commas, spaces or lines, once each and in order', () => {
    expect(parseLanguagePrefixes('/es/, /en/\n/ca  pt-br,en')).toEqual({
      ok: true,
      prefixes: ['/ca', '/en', '/es', '/pt-br'],
    })
    expect(parseLanguagePrefixes('')).toEqual({ ok: true, prefixes: [] })
  })

  it('refuses a list with something that is not a directory, or too long a list', () => {
    expect(parseLanguagePrefixes('/es, /en/us')).toEqual({ ok: false, error: 'prefix' })
    const many = Array.from({ length: LANGUAGE_LIMITS.prefixes + 1 }, (_, i) => `l${i}`).join(' ')
    expect(parseLanguagePrefixes(many)).toEqual({ ok: false, error: 'limit' })
  })

  it('compares configurations whatever the order they were written in', () => {
    const a: LanguageConfig = { prefixes: ['/es', '/en'], unprefixed: false }
    const b: LanguageConfig = { prefixes: ['/en', '/es', '/en'], unprefixed: false }
    expect(sameLanguages(a, b)).toBe(true)
    expect(sameLanguages(a, { ...b, unprefixed: true })).toBe(false)
    expect(sameLanguages(a, { prefixes: ['/en'], unprefixed: false })).toBe(false)
    expect(canonicalLanguages(b)).toEqual({ prefixes: ['/en', '/es'], unprefixed: false })
  })
})

describe('a path shared between languages', () => {
  const on = (selector: AuditSelector, target: string, languages = LANGUAGES) =>
    matches(selector, `https://example.com${target}`, languages)

  it('is read from a selector as shared, and literal when nothing says', () => {
    expect(parse({ kind: 'path', value: '/cart', query: 'any', scope: 'shared' })).toEqual({
      ok: true,
      selector: shared('/cart'),
    })
    expect(parse({ kind: 'prefix', value: '/account/', query: 'any', scope: 'shared' })).toEqual({
      ok: true,
      selector: sharedPrefix('/account'),
    })
    expect(parse({ kind: 'path', value: '/cart', query: 'any' })).toEqual({
      ok: true,
      selector: path('/cart'),
    })
    // An exact URL has no scope: it is always literal.
    expect(parse({ kind: 'url', value: '/cart' })).toMatchObject({
      selector: { kind: 'url' },
    })
  })

  it('is not the same selector as the literal one', () => {
    expect(selectorKey(shared('/cart'))).not.toBe(selectorKey(path('/cart')))
    expect(selectorKey(sharedPrefix('/cart'))).not.toBe(selectorKey(prefix('/cart')))
    // What was stored with the literal scope keeps its key.
    expect(selectorKey(path('/cart'))).toBe('path /cart *')
  })

  it('covers the path in every declared directory and with none', () => {
    const selector = shared('/cart')
    for (const covered of ['/cart', '/es/cart', '/en/cart', '/ca/cart']) {
      expect(on(selector, covered)).toBe(true)
    }
    for (const out of ['/fr/cart', '/es/cartoon', '/shop/es/cart', '/es/cart/', '/cart/', '/es']) {
      expect(on(selector, out)).toBe(false)
    }
  })

  it('does not look at the root when the domain has no pages without a directory', () => {
    const languages = { ...LANGUAGES, unprefixed: false }
    expect(on(shared('/cart'), '/es/cart', languages)).toBe(true)
    expect(on(shared('/cart'), '/cart', languages)).toBe(false)
  })

  it('covers nothing when no language is declared and the root is not enabled', () => {
    expect(on(shared('/cart'), '/cart', NO_LANGUAGES)).toBe(false)
    expect(on(shared('/cart'), '/es/cart', NO_LANGUAGES)).toBe(false)
    // …and the root only, once it is enabled.
    const root = { prefixes: [], unprefixed: true }
    expect(on(shared('/cart'), '/cart', root)).toBe(true)
    expect(on(shared('/cart'), '/es/cart', root)).toBe(false)
  })

  it('only takes off a declared directory, never one it guesses', () => {
    expect(on(shared('/cart'), '/fr/cart')).toBe(false)
    expect(on(shared('/fr/cart'), '/fr/cart')).toBe(true)
    // …and only one: what follows is part of the path.
    expect(on(shared('/en/cart'), '/es/en/cart')).toBe(true)
    expect(on(shared('/cart'), '/es/en/cart')).toBe(false)
  })

  it('compares by whole segments, keeping the case and encoding of the URL', () => {
    expect(on(shared('/cart'), '/ES/cart')).toBe(false)
    expect(on(shared('/cart'), '/esp/cart')).toBe(false)
    expect(on(shared('/a%2Fb'), '/es/a%2Fb')).toBe(true)
    expect(on(shared('/a/b'), '/es/a%2Fb')).toBe(false)
    expect(on(shared('/'), '/es')).toBe(true)
    expect(on(shared('/'), '/es/')).toBe(true)
  })

  it('does not translate slugs', () => {
    expect(on(shared('/carrito'), '/es/carrito')).toBe(true)
    expect(on(shared('/carrito'), '/en/cart')).toBe(false)
    expect(on(shared('/cart'), '/es/carrito')).toBe(false)
  })

  it('covers a prefix in every directory, by segments', () => {
    const selector = sharedPrefix('/account')
    for (const covered of [
      '/account',
      '/account/',
      '/account/orders',
      '/es/account',
      '/es/account/orders',
      '/en/account/orders/1',
      '/ca/account/',
    ]) {
      expect(on(selector, covered)).toBe(true)
    }
    for (const out of [
      '/accounts',
      '/es/accounts',
      '/fr/account',
      '/shop/account',
      '/es/shop/account',
    ]) {
      expect(on(selector, out)).toBe(false)
    }
  })

  it('keeps asking for the query, as the literal rules do', () => {
    const selector = shared('/search', exact('q=1'))
    expect(matches(selector, 'https://example.com/es/search?q=1', LANGUAGES)).toBe(true)
    expect(matches(selector, 'https://example.com/es/search?q=2', LANGUAGES)).toBe(false)
    expect(matches(selector, 'https://example.com/es/search', LANGUAGES)).toBe(false)
  })

  it('never changes the URL it is resolving: only what is compared', () => {
    const parts = urlPartsOf('https://example.com/es/cart?x=1', HOST, LANGUAGES)!
    expect(parts).toMatchObject({
      href: 'https://example.com/es/cart?x=1',
      pathname: '/es/cart',
      search: '?x=1',
      language: '/es',
      shared: '/cart',
    })
    expect(urlPartsOf('https://example.com/cart', HOST, LANGUAGES)).toMatchObject({
      language: '',
      shared: '/cart',
    })
    expect(urlPartsOf('https://example.com/cart', HOST)).toMatchObject({
      language: '',
      shared: null,
    })
  })
})

describe('precedence with languages', () => {
  const on = (rules: AuditRule[], target: string, languages = LANGUAGES) =>
    compileAuditRules(rules, HOST, { languages }).resolve(`https://example.com${target}`)
  const decided = (rules: AuditRule[], target: string, languages = LANGUAGES) =>
    on(rules, target, languages).audit.rule

  it('lets a general shared rule and a literal exception for one language live together', () => {
    const general = audit(shared('/cart'), 'exclude')
    const exception = audit(path('/es/cart'), 'include')
    expect(decided([general, exception], '/es/cart')).toBe(exception)
    expect(decided([general, exception], '/en/cart')).toBe(general)
    expect(decided([general, exception], '/cart')).toBe(general)
    expect(decided([exception, general], '/es/cart')).toBe(exception)
  })

  it('puts an exact URL before a literal path before a shared path before a prefix', () => {
    const prefixRule = audit(sharedPrefix('/cart'), 'exclude')
    const sharedPath = audit(shared('/cart'), 'include')
    const literalPath = audit(path('/es/cart'), 'exclude')
    const exactUrl = audit(url('https://example.com/es/cart'), 'include')
    expect(decided([prefixRule, sharedPath], '/es/cart')).toBe(sharedPath)
    expect(decided([prefixRule, sharedPath, literalPath], '/es/cart')).toBe(literalPath)
    expect(decided([prefixRule, sharedPath, literalPath, exactUrl], '/es/cart')).toBe(exactUrl)
    // The shared path is more specific than a longer literal prefix would be.
    expect(decided([sharedPath, audit(prefix('/es/cart'), 'exclude')], '/es/cart')).toBe(sharedPath)
  })

  it('compares prefixes by how much of the URL they cover, literal or shared', () => {
    const wide = audit(prefix('/es'), 'exclude')
    const narrow = audit(sharedPrefix('/account'), 'include')
    // `/es/account` covers 11 characters of /es/account/orders, `/es` only 3.
    expect(decided([wide, narrow], '/es/account/orders')).toBe(narrow)
    expect(decided([wide, narrow], '/es/blog')).toBe(wide)
    expect(decided([narrow], '/account/orders')).toBe(narrow)

    const longer = audit(sharedPrefix('/account/orders'), 'include')
    const literal = audit(prefix('/es/account'), 'exclude')
    expect(decided([literal, longer], '/es/account/orders/1')).toBe(longer)
    expect(decided([literal, longer], '/es/account/settings')).toBe(literal)
  })

  it('lets a literal prefix win when it covers exactly as much as a shared one', () => {
    const sharedRule = audit(sharedPrefix('/account'), 'include')
    const literalRule = audit(prefix('/es/account'), 'exclude')
    expect(decided([sharedRule, literalRule], '/es/account/orders')).toBe(literalRule)
    expect(decided([literalRule, sharedRule], '/es/account/orders')).toBe(literalRule)
    expect(decided([sharedRule, literalRule], '/en/account/orders')).toBe(sharedRule)
  })

  it('puts a query that is asked for before one that is ignored, within a scope and a path', () => {
    const ignoring = audit(shared('/search'), 'exclude')
    const asking = audit(shared('/search', exact('page=2')), 'include')
    expect(decided([ignoring, asking], '/es/search?page=2')).toBe(asking)
    expect(decided([ignoring, asking], '/es/search?page=3')).toBe(ignoring)
    expect(decided([ignoring, asking], '/search?page=2')).toBe(asking)
  })

  it('does not depend on the order the rules came in', () => {
    const rules = [
      audit(sharedPrefix('/account'), 'exclude'),
      audit(prefix('/es'), 'include'),
      audit(shared('/account/help'), 'exclude'),
      audit(path('/es/account/help'), 'include'),
      audit(sharedPrefix('/', exact('x=1')), 'exclude'),
    ]
    const targets = [
      '/es/account',
      '/es/account/help',
      '/en/account/help',
      '/account/help',
      '/es/blog?x=1',
      '/es/blog',
    ]
    const expected = targets.map((target) => decided(rules, target)?.id)
    for (let round = 0; round < 10; round++) {
      const shuffled = [...rules].sort(() => Math.random() - 0.5)
      expect(targets.map((target) => decided(shuffled, target)?.id)).toEqual(expected)
    }
  })

  it('resolves the same rules as literal ones when no language is declared', () => {
    const rule = audit(shared('/cart'), 'exclude')
    expect(decided([rule], '/cart', NO_LANGUAGES)).toBeNull()
    const literal = audit(path('/cart'), 'exclude')
    expect(decided([literal], '/cart', NO_LANGUAGES)).toBe(literal)
  })

  it('lists, for a URL, every rule that covers it with the winner first', () => {
    const compiled = compileAuditRules(
      [
        audit(shared('/cart'), 'exclude'),
        audit(path('/es/cart'), 'include'),
        audit(sharedPrefix('/'), 'exclude'),
      ],
      HOST,
      { languages: LANGUAGES },
    )
    const covering = compiled.covering('https://example.com/es/cart')
    expect(covering).toHaveLength(3)
    expect(covering[0]!.selector).toEqual(path('/es/cart'))
    // `/fr` is not declared, so it is just a path without a directory: only the root rule covers it.
    expect(compiled.covering('https://example.com/fr/cart').map((rule) => rule.selector)).toEqual([
      sharedPrefix('/'),
    ])
  })
})

describe('accepting nofollow', () => {
  const on = (rules: AuditRule[], target: string) =>
    compileAuditRules(rules, HOST, { languages: LANGUAGES }).resolve(`https://example.com${target}`)
      .intent

  it('is not accepted unless a rule says so, whatever the intent', () => {
    expect(on([], '/a')).toMatchObject({ acceptNofollow: false })
    expect(on([intent(prefix('/a'), 'not-indexable')], '/a')).toMatchObject({
      value: 'not-indexable',
      acceptNofollow: false,
    })
  })

  it('goes with either expectation', () => {
    expect(on([intent(prefix('/a'), 'indexable', { acceptNofollow: true })], '/a/x')).toMatchObject(
      { value: 'indexable', acceptNofollow: true },
    )
    expect(
      on([intent(prefix('/a'), 'not-indexable', { acceptNofollow: true })], '/a/x'),
    ).toMatchObject({ value: 'not-indexable', acceptNofollow: true })
  })

  it('belongs to the rule that decides the intent, and is not merged with other rules', () => {
    const general = intent(prefix('/a'), 'not-indexable', { acceptNofollow: true })
    const exception = intent(url('https://example.com/a/b'), 'indexable')
    expect(on([general, exception], '/a/b')).toMatchObject({
      value: 'indexable',
      acceptNofollow: false,
      rule: exception,
    })
    expect(on([general, exception], '/a/c')).toMatchObject({ acceptNofollow: true })
  })

  it('follows the scope of its rule', () => {
    const rule = intent(sharedPrefix('/blog'), 'indexable', { acceptNofollow: true })
    expect(on([rule], '/es/blog/post')).toMatchObject({ acceptNofollow: true })
    expect(on([rule], '/fr/blog/post')).toMatchObject({ acceptNofollow: false })
  })
})

describe('what a configuration meant', () => {
  const HOME = 'https://example.com/es/cart'
  const legacyRules: AuditRule[] = [
    intent(prefix('/blog'), 'indexable'),
    intent(url('https://example.com/blog/draft'), 'none'),
  ]

  it('is the current one for what is made now', () => {
    const snapshot = auditSnapshotOf(2, [], LANGUAGES)
    expect(snapshot).toMatchObject({ semantics: AUDIT_SEMANTICS, version: 2 })
    expect(snapshot.languages).toEqual(LANGUAGES)
    expect(semanticsOf(snapshot)).toBe(AUDIT_SEMANTICS)
  })

  it('is the first one for a snapshot that says nothing', () => {
    expect(semanticsOf(EMPTY_AUDIT_SNAPSHOT)).toBe(1)
    expect(semanticsOf({})).toBe(1)
    // With the meaning it had: nothing was expected of a URL no rule covered.
    expect(compileAuditSnapshot(EMPTY_AUDIT_SNAPSHOT, HOST).resolve(HOME).intent).toEqual({
      value: 'none',
      rule: null,
      acceptNofollow: false,
    })
    expect(compileAuditRules([], HOST).resolve(HOME).intent.value).toBe('indexable')
  })

  it('reads a snapshot stored before scopes, languages and nofollow existed', () => {
    const stored = JSON.stringify({
      version: 4,
      rules: [
        {
          id: 'a',
          dimension: 'audit',
          value: 'exclude',
          selector: { kind: 'prefix', path: '/cart', query: { mode: 'any' } },
          reason: 'The cart',
          enabled: true,
        },
        {
          id: 'b',
          dimension: 'intent',
          value: 'none',
          selector: { kind: 'path', path: '/blog', query: { mode: 'exact', value: '' } },
          reason: null,
          enabled: true,
        },
      ],
    })
    const snapshot = parseAuditSnapshot(stored)!
    expect(snapshot.semantics).toBeUndefined()
    expect(snapshot.rules[0]).toMatchObject({ selector: { scope: 'literal' } })
    expect(snapshot.rules[1]).toMatchObject({ value: 'none', acceptNofollow: false })
    const resolver = compileAuditSnapshot(snapshot, HOST)
    expect(resolver.resolve('https://example.com/cart/x').audit.value).toBe('excluded')
    expect(resolver.resolve('https://example.com/blog').intent).toMatchObject({
      value: 'none',
      rule: { id: 'b' },
    })
    // What no rule covers had no intent then, and the new default is not applied to it.
    expect(resolver.resolve('https://example.com/about').intent.value).toBe('none')
  })

  it('keeps `none` as a way to cancel a broader rule for the semantics that had it', () => {
    const old = compileAuditRules(legacyRules, HOST, { semantics: 1 })
    expect(old.resolve('https://example.com/blog/draft').intent).toMatchObject({ value: 'none' })
    expect(old.resolve('https://example.com/blog/post').intent.value).toBe('indexable')
  })

  it('ignores `none` for the current semantics: the broader rule applies again', () => {
    const now = compileAuditRules(legacyRules, HOST)
    expect(now.resolve('https://example.com/blog/draft').intent).toMatchObject({
      value: 'indexable',
      rule: { selector: { kind: 'prefix', path: '/blog' } },
    })
    expect(
      compileAuditRules([legacyRules[1]!], HOST).resolve('https://example.com/blog/draft').intent,
    ).toMatchObject({ value: 'indexable', rule: null })
  })

  it('does not accept nofollow, or read shared selectors, under the first semantics', () => {
    const rules = [
      intent(prefix('/a'), 'indexable', { acceptNofollow: true }),
      audit(shared('/cart'), 'exclude'),
    ]
    const old = compileAuditRules(rules, HOST, { semantics: 1, languages: LANGUAGES })
    expect(old.resolve('https://example.com/a').intent.acceptNofollow).toBe(false)
    expect(old.resolve('https://example.com/es/cart').audit.rule).toBeNull()
  })

  it('does not apply the languages of today to a snapshot that had none', () => {
    const rules = [audit(shared('/cart'), 'exclude')]
    const today = auditSnapshotOf(5, rules, LANGUAGES)
    const before = { ...today, languages: undefined, semantics: undefined }
    expect(compileAuditSnapshot(today, HOST).resolve(HOME).audit.value).toBe('excluded')
    expect(compileAuditSnapshot(before, HOST).resolve(HOME).audit.value).toBe('audited')
  })

  it('round-trips the languages and semantics it keeps', () => {
    const snapshot = auditSnapshotOf(
      9,
      [intent(shared('/cart'), 'not-indexable', { acceptNofollow: true })],
      LANGUAGES,
    )
    const restored = parseAuditSnapshot(serializeAuditSnapshot(snapshot))!
    expect(restored).toEqual(snapshot)
    expect(compileAuditSnapshot(restored, HOST).resolve(HOME).intent).toMatchObject({
      value: 'not-indexable',
      acceptNofollow: true,
    })
  })
})

describe('intentOutcome for the intents that exist', () => {
  it('has the same outcomes for the default expectation as for a declared one', () => {
    expect(intentOutcome('indexable', 'indexable')).toBe('met')
    expect(intentOutcome('indexable', 'unknown')).toBe('unknown')
    expect(intentOutcome('not-indexable', 'unknown')).toBe('unknown')
  })

  it('has nothing to say of the retired intent', () => {
    const none: RecordedIntent = 'none'
    expect(intentOutcome(none, 'indexable')).toBe('none')
  })

  it('keeps the type of what can be configured to what is expected', () => {
    const configurable: IndexIntent[] = ['indexable', 'not-indexable']
    expect(configurable).toHaveLength(2)
  })
})
