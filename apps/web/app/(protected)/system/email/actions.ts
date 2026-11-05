'use server'

import {
  alertLocaleOf,
  createMailer,
  MAIL_PAUSED,
  getMailConfig,
  readMailConfig,
  safeMailError,
  setMailConfig,
  testEmail,
} from '@seotools/core'
import { isValidEmail, normalizeEmail } from '@seotools/db'
import { revalidatePath } from 'next/cache'
import { getLocale, getTranslations } from 'next-intl/server'
import { getDb } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { parseMailForm, secretsOf } from '@/lib/mail-config'
import { requireAdmin } from '@/lib/session'
import { getSettings } from '@/lib/settings'

export interface EmailActionState {
  /** Set after a successful save, to confirm it. */
  saved?: boolean
  /** The test email went to this address. */
  sent?: string
  /** Something to correct in what was typed. */
  error?: string
  /** What the provider answered when it did not accept the test email: cleaned of secrets. */
  failure?: string
}

/** A provider that does not answer must end as a message, not as a page that never loads. */
const TEST_TIMEOUT_MS = 30_000

/** Chooses how the instance sends email. A secret left blank keeps the one stored. */
export async function saveMailConfigAction(
  _previous: EmailActionState,
  formData: FormData,
): Promise<EmailActionState> {
  await requireAdmin()
  const t = await getTranslations('Email.errors')
  const settings = await getSettings()
  const parsed = parseMailForm(formData, await getMailConfig(settings))
  if (!parsed.ok) return { error: t(parsed.error) }
  await setMailConfig(settings, parsed.config)
  revalidatePath('/system/email')
  revalidatePath('/system')
  return { saved: true }
}

/**
 * Sends a short email with the saved settings and says what came of it, right away. The attempt is
 * recorded like any other, so a success also clears the warning in System. What the provider answers
 * is shown after taking the credentials out of it, and neither is logged.
 */
export async function sendTestEmailAction(
  _previous: EmailActionState,
  formData: FormData,
): Promise<EmailActionState> {
  await requireAdmin()
  const t = await getTranslations('Email.errors')
  const to = normalizeEmail(String(formData.get('to') ?? ''))
  if (!isValidEmail(to)) return { error: t('address') }
  if (getEnv().SEOTOOLS_PAUSE_AUTOMATION) {
    await (
      await getDb()
    ).mail.record({
      kind: 'test',
      recipient: to,
      status: 'unconfigured',
      error: MAIL_PAUSED,
    })
    revalidatePath('/system/email')
    return { error: t('paused') }
  }
  const read = await readMailConfig(await getSettings())
  if (read.state === 'undecryptable') return { error: t('undecryptable') }
  if (read.state === 'missing') return { error: t('notConfigured') }
  const config = read.value

  const db = await getDb()
  const message = testEmail(alertLocaleOf(await getLocale()))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      createMailer(config).send({ to, ...message }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('The provider did not answer in time')),
          TEST_TIMEOUT_MS,
        )
      }),
    ])
    await db.mail.record({ kind: 'test', recipient: to, status: 'sent' })
    return { sent: to }
  } catch (error) {
    const failure = safeMailError(error, secretsOf(config))
    await db.mail.record({ kind: 'test', recipient: to, status: 'failed', error: failure })
    return { failure }
  } finally {
    clearTimeout(timer)
    revalidatePath('/system/email')
    revalidatePath('/system')
  }
}
