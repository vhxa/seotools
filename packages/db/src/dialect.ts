import type { Dialect } from './types'

/** Infers the SQL dialect from a connection string, unless one is given explicitly. */
export function detectDialect(url: string, explicit?: Dialect): Dialect {
  if (explicit) return explicit
  const lower = url.trim().toLowerCase()
  if (lower.startsWith('postgres://') || lower.startsWith('postgresql://')) return 'pg'
  if (/^(mysql2?|mariadb):\/\//.test(lower)) return 'mysql'
  if (lower.startsWith('file:') || lower.startsWith('sqlite:') || lower === ':memory:') {
    return 'sqlite'
  }
  throw new Error(
    `Cannot infer the database dialect from DATABASE_URL ("${lower.split('://')[0]}…"). ` +
      'Use file:…, postgres://… or mysql://…, or set DATABASE_DIALECT.',
  )
}

/** `file:./a.db` → `./a.db`, `file:///data/a.db` → `/data/a.db`, `:memory:` stays. */
export function sqlitePathFromUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed === ':memory:' || trimmed === 'file::memory:') return ':memory:'
  const withoutScheme = trimmed.replace(/^(file|sqlite):/i, '')
  const noQuery = withoutScheme.split('?')[0] ?? withoutScheme
  return noQuery.startsWith('//') ? noQuery.replace(/^\/\/(?=\/)/, '') : noQuery
}
