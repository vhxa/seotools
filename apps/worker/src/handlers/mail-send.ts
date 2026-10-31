import { mailSendPayload } from '@seotools/core'
import { PermanentJobError, type JobHandler } from '../types'

/** Sends an email through whichever provider the admin configured (SMTP or Resend). */
export const mailSend: JobHandler = async (job, ctx) => {
  const parsed = mailSendPayload.safeParse(job.payload)
  if (!parsed.success) throw new PermanentJobError(`Invalid payload: ${parsed.error.message}`)
  if (!parsed.data.text && !parsed.data.html) {
    throw new PermanentJobError('Mail needs `text` or `html`')
  }

  // Not configured is retryable: the admin may set it up while the job is waiting.
  const mailer = await ctx.getMailer()
  if (!mailer) throw new Error('No email provider configured')

  const { id } = await mailer.send(parsed.data)
  return { messageId: id ?? null }
}
