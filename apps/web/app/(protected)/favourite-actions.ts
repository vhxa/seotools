'use server'

import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db'
import { requireViewer } from '@/lib/session'
import { visibleCompanies } from '@/lib/workspace'

/** A personal preference: viewers can choose it without editing the domain. */
export async function toggleFavouriteAction(host: string) {
  const viewer = await requireViewer()
  if (typeof host !== 'string' || host.length === 0 || host.length > 253) notFound()
  const companies = await visibleCompanies(viewer)
  const domain = companies
    .flatMap((company) => company.domains)
    .find((domain) => domain.host === host)
  if (!domain) notFound()
  const db = await getDb()
  const userId = viewer.session.user.id
  const current = await db.userPreferences.favouriteDomainId(userId)
  await db.userPreferences.setFavouriteDomain(userId, current === domain.id ? null : domain.id)
  revalidatePath('/', 'layout')
}
