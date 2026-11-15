import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CLIENT_NAMESPACES } from './client-namespaces'

/**
 * Client code gets only the namespaces in `CLIENT_NAMESPACES`, so one that reads another would show
 * a missing message in the browser while every server render looks fine. "Client code" is every
 * `'use client'` file and every module it imports, through relative and `@/` imports: those run in
 * the browser too, even without the directive.
 */
const ROOT = join(__dirname, '..')

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.next') return []
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const isClientFile = (source: string) =>
  /^\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(['"])use client\1/.test(source)

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(ROOT, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : null
  if (!base) return null
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function importsOf(file: string, source: string): string[] {
  const specifiers = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g)].map(
    (match) => match[2] ?? '',
  )
  return specifiers.flatMap((specifier) => resolveImport(file, specifier) ?? [])
}

const sources = new Map<string, string>()
for (const path of filesUnder(ROOT)) {
  if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !/node_modules|\.next/.test(path)) {
    sources.set(path, withoutComments(readFileSync(path, 'utf8')))
  }
}
// The directive is read from the raw file: comments before it are allowed, and stripped here.
const clientRoots = [...sources.keys()].filter((path) => isClientFile(readFileSync(path, 'utf8')))

/** Every module that can run in the browser: the `'use client'` files and what they import. */
const clientCode = new Set<string>(clientRoots)
const queue = [...clientRoots]
while (queue.length > 0) {
  const file = queue.pop() as string
  for (const imported of importsOf(file, sources.get(file) ?? '')) {
    if (sources.has(imported) && !clientCode.has(imported)) {
      clientCode.add(imported)
      queue.push(imported)
    }
  }
}

const rel = (path: string) => path.slice(ROOT.length + 1)

describe('client messages', () => {
  const used = new Map<string, string[]>()
  const unreadable: string[] = []
  for (const file of clientCode) {
    const source = sources.get(file) ?? ''
    const calls = source.match(/\buseTranslations\s*\(/g)?.length ?? 0
    const literal = [
      ...source.matchAll(/\buseTranslations\s*\(\s*(['"])([A-Za-z0-9_.]+)\1\s*[,)]/g),
    ]
    if (literal.length !== calls) unreadable.push(rel(file))
    for (const match of literal) {
      const namespace = (match[2] ?? '').split('.')[0] ?? ''
      used.set(namespace, [...(used.get(namespace) ?? []), rel(file)])
    }
  }

  it('finds the client code it should', () => {
    expect(clientRoots.length).toBeGreaterThan(50)
    expect(clientCode.size).toBeGreaterThan(clientRoots.length)
  })

  it('reads every useTranslations call in client code: a literal namespace, always', () => {
    expect(unreadable, 'useTranslations() without a literal namespace in client code').toEqual([])
  })

  it('lists every namespace client code uses', () => {
    const missing = [...used.entries()]
      .filter(([namespace]) => !CLIENT_NAMESPACES.includes(namespace))
      .map(([namespace, files]) => `${namespace} (${[...new Set(files)].join(', ')})`)
    expect(missing, 'add these to CLIENT_NAMESPACES').toEqual([])
  })

  it('lists no namespace that client code does not use', () => {
    expect(CLIENT_NAMESPACES.filter((namespace) => !used.has(namespace))).toEqual([])
  })

  it('has no duplicates, and only namespaces that exist', () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, 'messages', 'en.json'), 'utf8')) as Record<
      string,
      unknown
    >
    expect(new Set(CLIENT_NAMESPACES).size).toBe(CLIENT_NAMESPACES.length)
    expect(CLIENT_NAMESPACES.filter((namespace) => !(namespace in catalog))).toEqual([])
  })

  it('never reaches the run-time translator from the browser', () => {
    // It takes a translator with no namespace, which client code may not make (see above), so it
    // could only be fed one scoped to a namespace; keep it on the server, where all messages exist.
    const users = [...clientCode].filter((file) =>
      /dynamic-translator/.test(sources.get(file) ?? ''),
    )
    expect(users.map(rel)).toEqual([])
  })
})
