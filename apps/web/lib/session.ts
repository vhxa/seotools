import type { AccessGrant, UserRole } from '@seotools/core'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import { getAuth } from './auth'
import { getDb } from './db'

/** Who is asking, read from the database on every request: a change of role acts at once. */
export interface Viewer {
  session: NonNullable<
    Awaited<ReturnType<Awaited<ReturnType<typeof getAuth>>['api']['getSession']>>
  >
  role: UserRole
  grants: AccessGrant[]
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  // Read headers first: it opts the caller out of static prerendering, which must happen
  // before getAuth() touches runtime-only environment variables.
  const requestHeaders = await headers()
  const auth = await getAuth()
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session) return null
  const db = await getDb()
  const user = await db.users.get(session.user.id)
  // Disabling removes the sessions too; this also covers one that was in flight.
  if (!user || user.disabledAt) return null
  return { session, role: user.role, grants: await db.users.grantsOf(user.id) }
})

export async function getSession() {
  return (await getViewer())?.session ?? null
}

/** For server components and actions: redirects to /login when there is no valid session. */
export async function requireSession() {
  const session = await getSession()
  if (!session) redirect('/login')
  return session
}

/** Like `requireSession`, with what the signed-in person may do. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer()
  if (!viewer) redirect('/login')
  return viewer
}

/**
 * For what concerns the whole instance rather than one domain: users, companies, the system,
 * updates. It is the one place that checks the role, and every such page and action calls it
 * itself. To anyone else these pages do not exist.
 */
export async function requireAdmin() {
  const viewer = await requireViewer()
  if (viewer.role !== 'admin') notFound()
  return viewer.session
}
