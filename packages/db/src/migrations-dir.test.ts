import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrationsDirOf } from './migrations-dir'

const has = (...roots: string[]) => {
  const journals = roots.map((root) => resolve(root, 'sqlite', 'meta', '_journal.json'))
  return (path: string) => journals.includes(path)
}

describe('migrationsDirOf', () => {
  it('finds the folder next to src/ (source) and from the worker bundle', () => {
    const repo = resolve('/repo/packages/db/migrations')
    expect(
      migrationsDirOf('sqlite', {
        here: '/repo/packages/db/src',
        env: undefined,
        exists: has(repo),
      }),
    ).toBe(resolve(repo, 'sqlite'))
    expect(
      migrationsDirOf('sqlite', {
        here: '/repo/apps/worker/dist',
        env: undefined,
        exists: has(repo),
      }),
    ).toBe(resolve(repo, 'sqlite'))
  })

  it('prefers MIGRATIONS_DIR', () => {
    expect(
      migrationsDirOf('sqlite', {
        here: '/repo/packages/db/src',
        env: '/app/migrations',
        exists: has('/app/migrations', '/repo/packages/db/migrations'),
      }),
    ).toBe(resolve('/app/migrations/sqlite'))
  })

  it('names where it looked and says to set MIGRATIONS_DIR when there is nothing', () => {
    expect(() =>
      migrationsDirOf('pg', { here: '/x/apps/worker/dist', env: undefined, exists: () => false }),
    ).toThrow(/Looked in: .*apps\/worker\/migrations\/pg.*Set MIGRATIONS_DIR/)
  })

  it('names a wrong MIGRATIONS_DIR', () => {
    expect(() =>
      migrationsDirOf('mysql', { here: '/x', env: '/nope', exists: () => false }),
    ).toThrow(/MIGRATIONS_DIR points to: .*nope.*mysql/)
  })
})
