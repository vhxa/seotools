'use server'

import { checkForUpdates, saveUpdateConfig } from '@seotools/core'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/session'
import { getSettings } from '@/lib/settings'

export interface UpdatesActionState {
  /** Set after a successful save, to confirm it. */
  saved?: boolean
}

/**
 * Looks for a new release now, on request. It is the only thing a visit to the page never does by
 * itself, and the page does not wait for it: it renders what was stored. A failure is stored too,
 * so that it shows as what it is.
 */
export async function checkForUpdatesAction(): Promise<void> {
  await requireAdmin()
  await checkForUpdates(await getSettings(), { trigger: 'manual' })
  revalidatePath('/system/updates')
}

/** Whether the worker looks for new releases once a day. */
export async function setPeriodicChecksAction(
  _previous: UpdatesActionState,
  formData: FormData,
): Promise<UpdatesActionState> {
  await requireAdmin()
  await saveUpdateConfig(await getSettings(), { periodicChecks: formData.get('periodic') === 'on' })
  revalidatePath('/system/updates')
  return { saved: true }
}
