import type { Mailer } from './types'

/**
 * The saved provider settings exist but cannot be read with the current key
 * (`SETTINGS_ENCRYPTION_KEY` / `BETTER_AUTH_SECRET` changed after they were saved).
 */
export const MAIL_UNDECRYPTABLE =
  'Saved email settings cannot be read with the current encryption key; enter them again in System → Email'

/** Email automation is paused (`SEOTOOLS_PAUSE_AUTOMATION`). */
export const MAIL_PAUSED = 'Email not sent: automation paused'

/**
 * A mailer that cannot send, with why. `deliver` records it as not sent (never as a provider
 * failure). `retry: false` means the job is done anyway (paused on purpose); otherwise the job is
 * retried, like when there is no provider, since an administrator may fix it while the job waits.
 */
export class MailUnavailableError extends Error {
  readonly retry: boolean
  constructor(message: string, options: { retry?: boolean } = {}) {
    super(message)
    this.name = 'MailUnavailableError'
    this.retry = options.retry ?? true
  }
}

/** A `Mailer` that is known not to be able to send, so that nothing is prepared for it. */
export type UnavailableMailer = Mailer & { readonly unavailable: MailUnavailableError }

export function isUnavailableMailer(mailer: Mailer): mailer is UnavailableMailer {
  return 'unavailable' in mailer && mailer.unavailable instanceof MailUnavailableError
}

export function unavailableMailer(
  message: string,
  options: { retry?: boolean } = {},
): UnavailableMailer {
  return {
    unavailable: new MailUnavailableError(message, options),
    async send() {
      throw new MailUnavailableError(message, options)
    },
    async verify() {
      throw new MailUnavailableError(message, options)
    },
  }
}
