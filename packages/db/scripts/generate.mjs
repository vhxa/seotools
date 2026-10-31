// Generates a migration for every dialect, forwarding extra args (e.g. --name add_reports).
import { spawnSync } from 'node:child_process'

// pnpm forwards a literal `--` when invoked as `pnpm db:generate -- --name x`.
const extra = process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === '--'))
for (const dialect of ['sqlite', 'pg', 'mysql']) {
  const result = spawnSync(
    'drizzle-kit',
    ['generate', '--config', `drizzle.${dialect}.config.ts`, ...extra],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  )
  if (result.status !== 0) process.exit(result.status ?? 1)
}
