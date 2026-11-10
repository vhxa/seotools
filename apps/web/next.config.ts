import { fileURLToPath } from 'node:url'
import { loadEnvConfig } from '@next/env'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import pkg from '../../package.json' with { type: 'json' }
import { webEnvSchema } from '../../packages/core/src/env'
import { STATIC_SECURITY_HEADERS } from './lib/security-headers'

// Next only reads .env from apps/web; load the monorepo-root .env too (dev only, no-op in prod).
const rootDir = fileURLToPath(new URL('../..', import.meta.url))
// `forceReload`: Next already loaded apps/web/.env once and caches that result.
const { combinedEnv } = loadEnvConfig(
  rootDir,
  process.env.NODE_ENV !== 'production',
  undefined,
  true,
)
const origins = webEnvSchema
  .pick({ BETTER_AUTH_URL: true, TRUSTED_ORIGINS: true })
  .parse(combinedEnv)
const allowedDevOrigins = [origins.BETTER_AUTH_URL, ...origins.TRUSTED_ORIGINS].flatMap(
  (origin) => {
    try {
      return [new URL(origin).hostname]
    } catch {
      return []
    }
  },
)

const config: NextConfig = {
  // Let the same trusted hosts load development assets when accessing the app through a tunnel.
  allowedDevOrigins,
  // Self-contained server (.next/standalone) for the Docker image.
  output: 'standalone',
  // Trace dependencies from the monorepo root so workspace packages are included.
  outputFileTracingRoot: rootDir,
  // Workspace packages ship TypeScript sources.
  transpilePackages: ['@seotools/core', '@seotools/db'],
  // Native / driver packages must be required at runtime, not bundled.
  serverExternalPackages: ['better-sqlite3', 'postgres', 'pino', 'nodemailer', 'resend'],
  env: { APP_VERSION: pkg.version },
  poweredByHeader: false,
  // The same on every response, static files included. The Content-Security-Policy and HSTS depend
  // on the request or on run-time settings, so `proxy.ts` sets them.
  async headers() {
    return [{ source: '/:path*', headers: [...STATIC_SECURITY_HEADERS] }]
  },
  // Old addresses keep working: companies moved under Administration and the pages overview became
  // the dashboard of the domain.
  async redirects() {
    return [
      { source: '/companies', destination: '/system/companies', permanent: false },
      { source: '/companies/new', destination: '/system/companies/new', permanent: false },
      { source: '/domains/:host/pages', destination: '/domains/:host', permanent: false },
    ]
  },
}

// Reads ./i18n/request.ts, where the locale and its messages are resolved per request.
const withNextIntl = createNextIntlPlugin()

export default withNextIntl(config)
