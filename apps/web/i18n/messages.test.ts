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
