import {
  isUnavailableMailer,
  MailUnavailableError,
  safeMailError,
  type Logger,
  type Mailer,
  type MailKind,
  type MailMessage,
} from '@seotools/core'
import type { Database } from '@seotools/db'

/** The most recipients of one message that are recorded each. */
const MAX_RECORDED_RECIPIENTS = 20

/** What is sent apart from who gets it. */
export type Content = Omit<MailMessage, 'to'>

export const NOT_CONFIGURED = 'No email provider configured'

/**
 * Sends a message and records the attempt, whatever happens: that is how a failure is seen in
 * System → Email. Only who it went to, the kind and what the provider answered are kept, never the
 * subject, the body or a link. A failure is thrown again, after being recorded, so the job is
 * retried as it always was; not having a provider is retryable too (an administrator may set it up
 * while the job waits), and is recorded as such.
 */
export async function deliver(input: {
  db: Database
  log: Logger
  mailer: Mailer | null
  kind: MailKind
  to: string | string[]
  /**
   * What to send, or how to make it: a function is only called once there is a provider to send it
   * with, so that nothing (a password link) is made for a message that cannot be sent.
   */
  content: Content | (() => Promise<Content>)
}): Promise<{ id?: string | undefined }> {
  const { db, log, mailer, kind } = input
  const recipients = (Array.isArray(input.to) ? input.to : [input.to]).slice(
    0,
    MAX_RECORDED_RECIPIENTS,
  )
  const record = async (status: 'sent' | 'failed' | 'unconfigured', error?: string) => {
    for (const recipient of recipients) {
      await db.mail
        .record({ kind, recipient, status, error: error ?? null })
        .catch((err) => log.warn({ err }, 'could not record an email delivery'))
    }
  }
  if (!mailer) {
    await record('unconfigured', NOT_CONFIGURED)
    throw new Error(NOT_CONFIGURED)
  }
  try {
    // Before making the content: nothing (a password link) is made for a message that cannot go.
    if (isUnavailableMailer(mailer)) throw mailer.unavailable
    const content = typeof input.content === 'function' ? await input.content() : input.content
    const sent = await mailer.send({ to: input.to, ...content })
    await record('sent')
    return sent
  } catch (error) {
    if (error instanceof MailUnavailableError) {
      // Nothing was handed to a provider: not sent, which is not a provider failure.
      await record('unconfigured', safeMailError(error))
      if (!error.retry) return {}
      throw error
    }
    await record('failed', safeMailError(error))
    throw error
  }
}
