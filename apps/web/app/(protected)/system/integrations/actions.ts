'use server'
import {
  createVitalsClient,
  JOB_TYPES,
  renderCheckPayload,
  GOOGLE_VITALS_KEY,
  googleVitalsKeySchema,
  loadVitalsKey,
  VitalsError,
  type VitalsFailure,
} from '@seotools/core'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { requireAdmin } from '@/lib/session'
import { getSettings } from '@/lib/settings'

export interface IntegrationState {
  result?:
    | VitalsFailure
    | 'invalid'
    | 'saved'
    | 'paused'
    | 'success'
    | 'no-data'
    | 'unchanged'
    | 'throttled'
}
export async function saveGoogleKeyAction(
  _state: IntegrationState,
  form: FormData,
): Promise<IntegrationState> {
  await requireAdmin()
  const settings = await getSettings()
  if (form.get('remove') === 'on') {
    const previous = await settings.readJson(GOOGLE_VITALS_KEY, googleVitalsKeySchema)
    if (previous.state === 'missing') return { result: 'unchanged' }
    await settings.delete(GOOGLE_VITALS_KEY)
  } else {
    const key = String(form.get('key') ?? '').trim()
    if (!key) return { result: 'unchanged' }
    const parsed = googleVitalsKeySchema.safeParse(key)
    if (!parsed.success) return { result: 'invalid' }
    const previous = await settings.readJson(GOOGLE_VITALS_KEY, googleVitalsKeySchema)
    if (previous.state === 'ready' && previous.value === parsed.data) return { result: 'unchanged' }
    await settings.setJson(GOOGLE_VITALS_KEY, parsed.data, { encrypted: true })
  }
  revalidatePath('/system/integrations')
  return { result: 'saved' }
}
let lastTestAt = -Infinity

export async function testGoogleKeyAction(
  _state: IntegrationState,
  _form: FormData,
): Promise<IntegrationState> {
  await requireAdmin()
  if (Date.now() - lastTestAt < 10_000) return { result: 'throttled' }
  lastTestAt = Date.now()
  if (getEnv().SEOTOOLS_PAUSE_AUTOMATION) return { result: 'paused' }
  const key = await loadVitalsKey(await getSettings())
  if (!key) return { result: 'no-key' }
  try {
    const answer = await createVitalsClient(key).crux({ origin: 'https://www.google.com' }, 'PHONE')
    return { result: answer ? 'success' : 'no-data' }
  } catch (error) {
    return { result: error instanceof VitalsError ? error.category : 'network' }
  }
}

export async function checkRenderBrowserAction(): Promise<void> {
  await requireAdmin()
  await (
    await getDb()
  ).jobs.enqueue({ type: JOB_TYPES.renderCheck, payload: renderCheckPayload.parse({}) })
  revalidatePath('/system/integrations')
}
