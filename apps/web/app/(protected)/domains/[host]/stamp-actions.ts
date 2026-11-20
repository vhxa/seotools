'use server'

import { dataStamp } from '@/lib/data-stamp'
import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

/** The domain's `dataStamp`, for the open page to notice that the worker changed something. */
export async function dataStampAction(host: string): Promise<string> {
  const { domain } = await requireDomain(host)
  return dataStamp(await getDb(), domain.id)
}
