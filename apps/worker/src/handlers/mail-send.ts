import { mailSendPayload } from '@seotools/core'
import type { Database } from '@seotools/db'
import { deliver } from '../mail/deliver'
import { PermanentJobError, type JobHandler } from '../types'

/** Sends an email through whichever provider the admin configured (SMTP or Resend). */
export function createMailSendHandler(deps: { db: Database }): JobHandler {
  return async (job, ctx) => {
    const parsed = mailSendPayload.safeParse(job.payload)
    if (!parsed.success) throw new PermanentJobError(`Invalid payload: ${parsed.error.message}`)
    if (!parsed.data.text && !parsed.data.html) {
      throw new PermanentJobError('Mail needs `text` or `html`')
    }

    // Not configured is retryable: the admin may set it up while the job is waiting.
    const { id } = await deliver({
      db: deps.db,
      log: ctx.log,
      mailer: await ctx.getMailer(),
      kind: 'other',
      to: parsed.data.to,
      content: parsed.data,
    })
    return { messageId: id ?? null }
  }
}
