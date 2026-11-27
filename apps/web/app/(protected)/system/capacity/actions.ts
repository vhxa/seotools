'use server'

import { CAPACITY_DISMISSED_KEY, CAPACITY_KEY, capacitySchema } from '@seotools/core/capacity'
import { getTranslations } from 'next-intl/server'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireAdmin } from '@/lib/session'

export type CapacityActionState = { saved?: boolean; error?: string }

export async function saveCapacityAction(
  _state: CapacityActionState,
  form: FormData,
): Promise<CapacityActionState> {
  await requireAdmin()
  const t = await getTranslations('Capacity')
  const integer = (value: FormDataEntryValue | null) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  const values = capacitySchema.safeParse({
    renders: integer(form.get('renders')),
    crawls: integer(form.get('crawls')),
  })
  if (!values.success) return { error: t('invalid') }
  const db = await getDb()
  if (!(await db.settings.get(CAPACITY_KEY))) return { error: t('waiting') }
  await db.settings.set(CAPACITY_KEY, JSON.stringify(values.data), false)
  revalidatePath('/system/capacity')
  return { saved: true }
}

export async function dismissCapacityUpgradeAction() {
  await requireAdmin()
  await (await getDb()).settings.set(CAPACITY_DISMISSED_KEY, 'true', false)
  revalidatePath('/system/capacity')
}
