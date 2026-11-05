import { getSessionCookie } from 'better-auth/cookies'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Optimistic gate: bounces visitors without a session cookie to /login (which in turn sends a
 * fresh install on to /setup). It only checks the cookie exists; the real session validation
 * happens in `requireSession()`.
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|login|setup|forgot-password|set-password|_next/static|_next/image|favicon.ico|icon.svg).*)',
  ],
}
