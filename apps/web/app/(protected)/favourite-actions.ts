'use server'

import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db'
import { requireViewer } from '@/lib/session'
import { visibleCompanies } from '@/lib/workspace'

/**
 * A personal preference: viewers can choose it without editing the domain. It sets the state the
 * button asked for rather than flipping it, so a page left open since another change cannot invert
 * it, and clearing only clears this domain, never a favourite chosen elsewhere since.
 */
export async function setFavouriteAction(host: string, favourite: boolean) {
  const viewer = await requireViewer()
  if (typeof host !== 'string' || host.length === 0 || host.length > 253) notFound()
  if (typeof favourite !== 'boolean') notFound()
  const companies = await visibleCompanies(viewer)
  const domain = companies
    .flatMap((company) => company.domains)
    .find((domain) => domain.host === host)
  if (!domain) notFound()
  const db = await getDb()
  const userId = viewer.session.user.id
  if (favourite) {
    await db.userPreferences.setFavouriteDomain(userId, domain.id)
  } else {
    const current = await db.userPreferences.favouriteDomainId(userId)
    if (current !== domain.id) return
    await db.userPreferences.setFavouriteDomain(userId, null)
  }
  revalidatePath('/', 'layout')
}
