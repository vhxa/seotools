import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUTH_SECRET, BASE_URL, DATABASE_URL, PORT, WORK_DIR } from './env'
import { seed } from './seed'

/**
 * Playwright's web server: a fresh SQLite database with the seed data, then the production build
 * (Next standalone) on its own port. The first user is created by the first spec, on /setup.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const web = resolve(root, 'apps/web/.next/standalone/apps/web')
if (!existsSync(resolve(web, 'server.js'))) {
  throw new Error('Build first: `pnpm build` makes apps/web/.next/standalone.')
}

rmSync(WORK_DIR, { recursive: true, force: true })
mkdirSync(WORK_DIR, { recursive: true })
process.env.MIGRATIONS_DIR = resolve(root, 'packages/db/migrations')
const db = await seed()
await db.close()

// What the Dockerfile copies next to the standalone server.
cpSync(resolve(root, 'apps/web/.next/static'), resolve(web, '.next/static'), { recursive: true })
if (existsSync(resolve(root, 'apps/web/public'))) {
  cpSync(resolve(root, 'apps/web/public'), resolve(web, 'public'), { recursive: true })
}

const server = spawn(process.execPath, ['server.js'], {
  cwd: web,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    HOSTNAME: '127.0.0.1',
    DATABASE_URL,
    BETTER_AUTH_SECRET: AUTH_SECRET,
    BETTER_AUTH_URL: BASE_URL,
    LOG_LEVEL: 'warn',
  },
})
server.on('exit', (code) => process.exit(code ?? 1))
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.kill(signal)
  })
}
