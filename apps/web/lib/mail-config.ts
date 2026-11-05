import type { MailConfig } from '@seotools/core'

/**
 * What the email form shows of the stored configuration: everything but the secrets. A secret is
 * never sent to the browser, only whether there is one.
 */
export type MailConfigView =
  | {
      provider: 'smtp'
      host: string
      port: number
      secure: boolean
      user: string
      from: string
      hasPassword: boolean
    }
  | { provider: 'resend'; from: string; hasApiKey: boolean }

export function viewOf(config: MailConfig | null): MailConfigView | null {
  if (!config) return null
  if (config.provider === 'resend') {
    return { provider: 'resend', from: config.from, hasApiKey: config.apiKey.length > 0 }
  }
  return {
    provider: 'smtp',
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user ?? '',
    from: config.from,
    hasPassword: Boolean(config.pass),
  }
}

export type MailFormError = 'provider' | 'host' | 'port' | 'from' | 'apiKey'

const MAX_FIELD = 254
const field = (data: FormData, name: string) => {
  const value = data.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Reads the email form. A secret left blank keeps the stored one (of the same provider): the form
 * never has it to send back. Removing the username removes the password with it.
 */
export function parseMailForm(
  data: FormData,
  stored: MailConfig | null,
): { ok: true; config: MailConfig } | { ok: false; error: MailFormError } {
  const provider = field(data, 'provider')
  const from = field(data, 'from')
  if (provider !== 'smtp' && provider !== 'resend') return { ok: false, error: 'provider' }
  if (!from.includes('@') || from.length > MAX_FIELD) return { ok: false, error: 'from' }

  if (provider === 'resend') {
    const typed = field(data, 'apiKey')
    const apiKey = typed || (stored?.provider === 'resend' ? stored.apiKey : '')
    if (!apiKey || apiKey.length > 512) return { ok: false, error: 'apiKey' }
    return { ok: true, config: { provider, apiKey, from } }
  }

  const host = field(data, 'host')
  if (!host || host.length > MAX_FIELD || /[\s/]/.test(host)) return { ok: false, error: 'host' }
  const portText = field(data, 'port')
  const port = Number(portText)
  if (!/^\d+$/.test(portText) || port < 1 || port > 65535) return { ok: false, error: 'port' }
  const user = field(data, 'user')
  const typed = String(data.get('pass') ?? '')
  const pass = user ? typed || (stored?.provider === 'smtp' ? (stored.pass ?? '') : '') : ''
  return {
    ok: true,
    config: {
      provider,
      host,
      port,
      secure: data.get('secure') === 'on',
      ...(user ? { user } : {}),
      ...(pass ? { pass } : {}),
      from,
    },
  }
}

/** The secrets of a configuration, to take out of anything shown about it. */
export const secretsOf = (config: MailConfig): string[] =>
  config.provider === 'smtp' ? [config.pass ?? ''] : [config.apiKey]
