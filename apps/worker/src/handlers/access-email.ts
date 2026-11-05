import { accessEmail, accessEmailPayload, setPasswordLink } from '@seotools/core'
import { USER_TOKEN_TTL_MS, issueUserToken, type Database } from '@seotools/db'
import { PermanentJobError, type JobHandler } from '../types'

/**
 * Emails someone a link to set their password. The link is made here, at the moment of sending, so
 * that no job in the database ever holds one.
 */
export function createAccessEmailHandler(deps: {
  db: Database
  publicUrl: string | undefined
}): JobHandler {
  return async (job, ctx) => {
    const parsed = accessEmailPayload.safeParse(job.payload)
    if (!parsed.success) throw new PermanentJobError(`Invalid payload: ${parsed.error.message}`)
    const { userId, kind, locale } = parsed.data
    if (!deps.publicUrl) {
      throw new PermanentJobError('BETTER_AUTH_URL is not set in the worker: no link can be made')
    }
    const user = await deps.db.users.get(userId)
    // Gone or disabled since it was asked for: there is nothing to send, and it is no failure.
    if (!user || user.disabledAt) return { skipped: true }

    // Not configured is retryable: the admin may set it up while the job is waiting.
    const mailer = await ctx.getMailer()
    if (!mailer) throw new Error('No email provider configured')

    const token = await issueUserToken(deps.db, { userId, kind })
    const link = setPasswordLink(deps.publicUrl, token)
    const { id } = await mailer.send({
      to: user.email,
      ...accessEmail({ kind, locale, link, ttlMs: USER_TOKEN_TTL_MS[kind] }),
    })
    return { messageId: id ?? null }
  }
}
