import { getSessionCookie } from 'better-auth/cookies'
import { NextResponse, type NextRequest } from 'next/server'
import { getEnv } from './lib/env'
import {
  STRICT_TRANSPORT_SECURITY,
  contentSecurityPolicy,
  createNonce,
  servedOverHttps,
} from './lib/security-headers'

/** Reachable without a session: signing in, the first-run setup and the password links. */
const PUBLIC_PATHS = /^\/(login|setup|forgot-password|set-password)(\/|$)/

/**
 * A domain's icon carries a stricter policy of its own (`favicon-response.ts`): it is bytes from a
 * third-party site, never a page of the app.
 */
const OWN_POLICY = /^\/domains\/[^/]+\/favicon$/

/**
 * Runs before every page:
 * - Optimistic gate: bounces visitors without a session cookie to /login (which in turn sends a
 *   fresh install on to /setup). It only checks the cookie exists; the real session validation
 *   happens in `requireSession()`.
 * - The Content-Security-Policy, with a nonce made for this response, and HSTS when the app is
 *   served over HTTPS. The headers that never change are in `next.config.ts`.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (!PUBLIC_PATHS.test(pathname) && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const env = getEnv()
  const https = servedOverHttps(env.BETTER_AUTH_URL)
  const response = OWN_POLICY.test(pathname)
    ? NextResponse.next()
    : withPolicy(request, { https, dev: env.NODE_ENV === 'development' })
  if (https) response.headers.set('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY)
  return response
}

function withPolicy(request: NextRequest, options: { https: boolean; dev: boolean }) {
  const nonce = createNonce()
  const policy = contentSecurityPolicy({ nonce, ...options })
  // Next.js reads the policy from the request to put the nonce on its own scripts; the root layout
  // reads `x-nonce` for the app's one inline script.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', policy)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', policy)
  return response
}

export const config = {
  matcher: [
    // Everything but the API, static files and what must be readable without a session.
    '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)',
  ],
}
