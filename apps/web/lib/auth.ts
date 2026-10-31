import type { WebEnv } from '@seotools/core'
import type { Database } from '@seotools/db'
import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { getDb } from './db'
import { getEnv } from './env'

/**
 * Single-admin auth. The admin user is created from ADMIN_EMAIL / ADMIN_PASSWORD at startup
 * (see `bootstrap` in @seotools/db), so public sign-up is disabled.
 */
export function createAuth(db: Database, env: WebEnv, plugins: BetterAuthPlugin[] = []) {
  return betterAuth({
    appName: 'seotools',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.TRUSTED_ORIGINS,
    database: drizzleAdapter(db.orm.db as never, {
      provider: db.dialect,
      schema: db.orm.schema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
    },
    session: { expiresIn: 60 * 60 * 24 * 7 },
    plugins,
  })
}

export type Auth = ReturnType<typeof createAuth>

const globalForAuth = globalThis as unknown as { __seotoolsAuth?: Promise<Auth> }

export function getAuth(): Promise<Auth> {
  return (globalForAuth.__seotoolsAuth ??= getDb().then((db) =>
    // nextCookies must be the last plugin: it lets server actions set the session cookie.
    createAuth(db, getEnv(), [nextCookies()]),
  ))
}
