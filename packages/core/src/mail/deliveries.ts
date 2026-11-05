/**
 * What is kept of every attempt to send an email, so that a failure can be seen. Never the body, the
 * subject or a link: only that something was sent to someone, and what the provider answered.
 */

/**
 * - `invite`, `reset`: the link to set a password (`access.email`).
 * - `alert`: a notice about a crawl (`crawl.alerts`).
 * - `test`: the test an administrator sends from System → Email.
 * - `other`: any other `mail.send` job.
 */
export const MAIL_KINDS = ['invite', 'reset', 'alert', 'test', 'other'] as const
export type MailKind = (typeof MAIL_KINDS)[number]

/** `unconfigured`: there was something to send and no email provider to send it. */
export const MAIL_STATUSES = ['sent', 'failed', 'unconfigured'] as const
export type MailStatus = (typeof MAIL_STATUSES)[number]

/** Recent attempts kept, however old, and for how long at most. Older ones are removed. */
export const MAIL_DELIVERIES_KEEP = 1000
export const MAIL_DELIVERIES_MAX_AGE_MS = 90 * 24 * 60 * 60_000

export const MAX_DELIVERY_ERROR_LENGTH = 500

/**
 * An error from a provider as it may be stored and shown: without the secrets of the configuration,
 * without a password link or token, on one line and short. Providers do not normally echo
 * credentials, but they are never trusted not to.
 */
export function safeMailError(
  error: unknown,
  secrets: readonly (string | undefined)[] = [],
): string {
  let text = error instanceof Error ? error.message : String(error)
  for (const secret of secrets) {
    if (secret && secret.length >= 3) text = text.split(secret).join('…')
  }
  text = text
    // A link keeps its host and loses its path and query, which is where a token would be.
    .replace(/\b(https?:\/\/[^/\s"'<>]+)[^\s"'<>]*/gi, '$1/…')
    .replace(/token=[^\s&"'<>]+/gi, 'token=…')
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 …')
    .replace(/\bre_[A-Za-z0-9_]{8,}/g, '…')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) text = 'Unknown error'
  return text.length > MAX_DELIVERY_ERROR_LENGTH
    ? `${text.slice(0, MAX_DELIVERY_ERROR_LENGTH - 1)}…`
    : text
}
