import type { MailDelivery } from '@seotools/db'

/**
 * Whether email is doing its job, from the latest attempt to send one. One attempt is enough to
 * speak: a delivery that failed is a person who did not get their invitation.
 * - `unconfigured`: something wanted to send and there was no provider, and there still is none.
 * - `failing`: the latest attempt failed. It clears with the next one that is sent.
 */
export type MailHealth = { state: 'ok' } | { state: 'unconfigured' } | { state: 'failing' }

export function mailHealth(input: {
  configured: boolean
  latest: MailDelivery | null
}): MailHealth {
  const { configured, latest } = input
  if (!latest || latest.status === 'sent') return { state: 'ok' }
  if (latest.status === 'unconfigured') {
    // The jobs that wanted to send are retried: with a provider now, they are not a problem.
    return configured ? { state: 'ok' } : { state: 'unconfigured' }
  }
  return { state: 'failing' }
}
