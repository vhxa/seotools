import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Dialect } from './types'

/**
 * Where the migrations of a dialect are. `MIGRATIONS_DIR` (the Docker image sets it) wins.
 * Otherwise the first of these that has them: `packages/db/migrations` seen from `src/` (tsx), and
 * from `apps/worker/dist/` (the bundle run outside Docker), where `here` is the bundle's folder.
 * Built with `path` instead of `new URL(…, import.meta.url)` so bundlers don't treat it as an asset.
 */
export function migrationsDirOf(
  dialect: Dialect,
  options: {
    here?: string
    env?: string | undefined
    exists?: (path: string) => boolean
  } = {},
): string {
  const here = options.here ?? dirname(fileURLToPath(import.meta.url))
  const exists = options.exists ?? existsSync
  const env = 'env' in options ? options.env : process.env.MIGRATIONS_DIR
  const journal = (root: string) => resolve(root, dialect, 'meta', '_journal.json')

  if (env) {
    if (exists(journal(env))) return resolve(env, dialect)
    throw notFound(dialect, [env], true)
  }
  const candidates = [
    resolve(here, '..', 'migrations'),
    resolve(here, '..', '..', '..', 'packages', 'db', 'migrations'),
  ]
  const found = candidates.find((root) => exists(journal(root)))
  if (!found) throw notFound(dialect, candidates, false)
  return resolve(found, dialect)
}

function notFound(dialect: Dialect, roots: string[], fromEnv: boolean) {
  const looked = roots.map((root) => resolve(root, dialect)).join(', ')
  return new Error(
    `Could not find the ${dialect} migrations folder (meta/_journal.json). ` +
      `${fromEnv ? 'MIGRATIONS_DIR points to' : 'Looked in'}: ${looked}. ` +
      'Set MIGRATIONS_DIR to the folder that contains the sqlite, pg and mysql migration folders ' +
      '(packages/db/migrations in the repository, /app/migrations in the Docker image).',
  )
}
