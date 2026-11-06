import { CRAWL_LINK_KINDS } from '@seotools/core'
import {
  ISSUE_GROUPS,
  ISSUE_IMPORTANCES,
  ISSUE_TYPES,
  PAGE_ISSUE_IDS,
} from '@seotools/core/crawl/issues'
import { IntlErrorCode, createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'
import en from '../messages/en.json'
import es from '../messages/es.json'

const catalogs = { en, es }

function flatten(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node }
  return Object.entries(node as Record<string, unknown>).reduce<Record<string, string>>(
    (all, [key, value]) => ({ ...all, ...flatten(value, prefix ? `${prefix}.${key}` : key) }),
    {},
  )
}

/** ICU arguments used by a message, e.g. `{host}` → `host`. */
const placeholders = (message: string) =>
  [...message.matchAll(/\{(\w+)/g)].map((match) => match[1]!).sort()

describe('message catalogs', () => {
  const reference = flatten(en)

  it.each(Object.entries(catalogs))('%s has no empty messages', (_locale, catalog) => {
    const empty = Object.entries(flatten(catalog)).filter(([, message]) => !message.trim())
    expect(empty).toEqual([])
  })

  it.each(Object.entries(catalogs))(
    '%s has exactly the keys of the English catalog',
    (_locale, catalog) => {
      expect(Object.keys(flatten(catalog)).sort()).toEqual(Object.keys(reference).sort())
    },
  )

  it.each(Object.entries(catalogs))(
    '%s uses the same ICU arguments as English',
    (_locale, catalog) => {
      const messages = flatten(catalog)
      for (const [key, message] of Object.entries(reference)) {
        expect({ key, args: placeholders(messages[key] ?? '') }).toEqual({
          key,
          args: placeholders(message),
        })
      }
    },
  )
})

describe('messages of the registries in @seotools/core', () => {
  it.each(Object.entries(catalogs))('%s describes every page issue', (_locale, catalog) => {
    const issues = catalog.PageIssues as Record<string, { name?: string; description?: string }>
    for (const id of PAGE_ISSUE_IDS) {
      expect({ id, name: Boolean(issues[id]?.name) }).toEqual({ id, name: true })
      expect({ id, description: Boolean(issues[id]?.description) }).toEqual({
        id,
        description: true,
      })
    }
  })

  it.each(Object.entries(catalogs))('%s names how issues are organised', (_locale, catalog) => {
    const names = catalog.IssueCatalog
    const missing = [
      ...ISSUE_GROUPS.map((group) => (names.groups as Record<string, string>)[group.id]),
      ...ISSUE_GROUPS.flatMap((group) =>
        group.categories.map((id) => (names.categories as Record<string, string>)[id]),
      ),
      ...ISSUE_TYPES.map((type) => names.types[type]),
      ...ISSUE_IMPORTANCES.map((importance) => names.importance[importance]),
    ].filter((name) => !name)
    expect(missing).toEqual([])
  })

  it.each(Object.entries(catalogs))('%s names every kind of link', (_locale, catalog) => {
    const kinds = catalog.LinkKinds as Record<string, string>
    for (const kind of CRAWL_LINK_KINDS)
      expect({ kind, name: kinds[kind] }).not.toEqual({ kind, name: undefined })
  })
})

describe('message syntax', () => {
  it.each(Object.entries(catalogs))('%s has only messages that parse as ICU', (locale, catalog) => {
    const invalid: string[] = []
    const t = createTranslator({
      locale: locale as keyof typeof catalogs,
      messages: catalog,
      onError: (error) => {
        if (error.code === IntlErrorCode.INVALID_MESSAGE) invalid.push(error.message)
      },
      getMessageFallback: ({ key }) => key,
    })
    const translate = t as unknown as (key: string, values?: Record<string, unknown>) => string
    for (const key of Object.keys(flatten(catalog))) {
      // Rich text tags are rendered with a function that returns their text.
      translate(key, new Proxy({}, { get: () => (chunks: unknown) => String(chunks) }))
    }
    expect(invalid).toEqual([])
  })
})
