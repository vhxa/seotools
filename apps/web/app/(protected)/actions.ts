'use server'

import { JOB_TYPES } from '@seotools/core'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireSession } from '@/lib/session'

export async function enqueueExampleJob() {
  await requireSession()
  const db = await getDb()
  await db.jobs.enqueue({
    type: JOB_TYPES.exampleEcho,
    payload: { message: 'Hello from the web UI', delayMs: 2000 },
  })
  revalidatePath('/')
}
