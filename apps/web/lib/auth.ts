import type { WebEnv } from '@seotools/core'
import type { Database } from '@seotools/db'
import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import { LOCALE_COOKIE, localeCookieOptions, parseLocale } from '../i18n/locale'
import { getDb } from './db'
import { getEnv } from './env'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password'
import { servedOverHttps } from './security-headers'

/**
 * Email/password auth. The first user registers on the first-run /setup page (see
 * `createFirstAdmin` in @seotools/db), so better-auth's public sign-up stays disabled.
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
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    session: { expiresIn: 60 * 60 * 24 * 7 },
    databaseHooks: {
      session: {
        create: {
          // A disabled account is told what anyone with a wrong password is told.
          before: async (session) => {
            const account = await db.users.get(session.userId)
            if (!account || account.disabledAt) {
              throw new APIError('UNAUTHORIZED', {
                code: 'INVALID_EMAIL_OR_PASSWORD',
                message: 'Invalid email or password',
              })
            }
          },
        },
      },
    },
    hooks: {
      // The saved language follows the person to another browser: it is put in the locale cookie
      // when they sign in, and "follow the browser" (nothing saved) clears it.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return
        const userId = ctx.context.newSession?.user.id
        if (!userId) return
        const options = localeCookieOptions(servedOverHttps(env.BETTER_AUTH_URL))
        const saved = parseLocale(await db.userPreferences.locale(userId))
        if (saved) ctx.setCookie(LOCALE_COOKIE, saved, options)
        else ctx.setCookie(LOCALE_COOKIE, '', { ...options, maxAge: 0 })
      }),
    },
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
