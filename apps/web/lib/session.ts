import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuth } from './auth'

export async function getSession() {
  // Read headers first: it opts the caller out of static prerendering, which must happen
  // before getAuth() touches runtime-only environment variables.
  const requestHeaders = await headers()
  const auth = await getAuth()
  return auth.api.getSession({ headers: requestHeaders })
}

/** For server components and actions: redirects to /login when there is no valid session. */
export async function requireSession() {
  const session = await getSession()
  if (!session) redirect('/login')
  return session
}

/**
 * For what concerns the whole instance rather than one domain: updates, the system. Roles are not
 * stored yet, so any signed-in account passes today; when they are, this is the one place that
 * checks them (as `requireDomain` is for domains). Every such page and action calls it itself.
 */
export async function requireAdmin() {
  return requireSession()
}
