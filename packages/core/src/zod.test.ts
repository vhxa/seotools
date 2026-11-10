import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = import.meta.dirname

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

describe('zod', () => {
  // Client components import core's pure modules; in a browser, zod must not probe for `eval`,
  // which the app's Content-Security-Policy reports as a violation (`zod.ts` turns it off).
  it('is imported only through ./zod, which configures it for the browser', () => {
    const direct = sources(SOURCE)
      .filter((path) => relative(SOURCE, path) !== 'zod.ts')
      .filter((path) => /from ['"]zod(\/[^'"]*)?['"]/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SOURCE, path))
    expect(direct).toEqual([])
  })
})
