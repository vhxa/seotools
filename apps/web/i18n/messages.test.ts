import { CRAWL_LINK_KINDS } from '@seotools/core'
import { PAGE_ISSUE_IDS } from '@seotools/core/crawl/issues'
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

  it.each(Object.entries(catalogs))('%s names every kind of link', (_locale, catalog) => {
    const kinds = catalog.LinkKinds as Record<string, string>
    for (const kind of CRAWL_LINK_KINDS)
      expect({ kind, name: kinds[kind] }).not.toEqual({ kind, name: undefined })
  })
})
