import type { MailDelivery } from '@seotools/db'

/**
 * Whether email is doing its job, from the latest attempt to send one. One attempt is enough to
 * speak: a delivery that failed is a person who did not get their invitation.
 * - `unconfigured`: something wanted to send and there was no provider, and there still is none.
 * - `failing`: the latest attempt failed. It clears with the next one that is sent.
 * - `undecryptable`: provider settings are saved but the current key cannot read them. It clears
 *   when new ones are saved.
 */
export type MailHealth =
  | { state: 'ok' }
  | { state: 'unconfigured' }
  | { state: 'failing' }
  | { state: 'undecryptable' }

export function mailHealth(input: {
  configured: boolean
  /** Settings are saved but cannot be read with the current key. */
  undecryptable?: boolean
  latest: MailDelivery | null
}): MailHealth {
  const { configured, latest } = input
  if (input.undecryptable) return { state: 'undecryptable' }
  if (!latest || latest.status === 'sent') return { state: 'ok' }
  if (latest.status === 'unconfigured') {
    // The jobs that wanted to send are retried: with a provider now, they are not a problem.
    return configured ? { state: 'ok' } : { state: 'unconfigured' }
  }
  return { state: 'failing' }
}
