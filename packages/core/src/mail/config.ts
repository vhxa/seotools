import type { SettingRead, Settings } from '../settings'
import { createMailer } from './mailer'
import { MAIL_UNDECRYPTABLE, unavailableMailer } from './unavailable'
import { mailConfigSchema, type MailConfig, type Mailer } from './types'

export const MAIL_CONFIG_KEY = 'mail.config'

/** The saved configuration, or why there is none: not saved, or saved with another key. */
export const readMailConfig = (settings: Settings): Promise<SettingRead<MailConfig>> =>
  settings.readJson(MAIL_CONFIG_KEY, mailConfigSchema)

/** The saved configuration; null when there is none or it cannot be read (see `readMailConfig`). */
export async function getMailConfig(settings: Settings): Promise<MailConfig | null> {
  const read = await readMailConfig(settings)
  return read.state === 'ready' ? read.value : null
}

/** Credentials are stored encrypted. */
export async function setMailConfig(settings: Settings, config: MailConfig) {
  await settings.setJson(MAIL_CONFIG_KEY, mailConfigSchema.parse(config), { encrypted: true })
}

/**
 * Returns null when the admin hasn't configured an email provider yet. Settings that cannot be
 * decrypted give a mailer that refuses to send, saying why (`MailUnavailableError`).
 */
export async function getMailer(settings: Settings): Promise<Mailer | null> {
  const read = await readMailConfig(settings)
  if (read.state === 'undecryptable') return unavailableMailer(MAIL_UNDECRYPTABLE)
  return read.state === 'ready' ? createMailer(read.value) : null
}
