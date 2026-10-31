import type { Settings } from '../settings'
import { createMailer } from './mailer'
import { mailConfigSchema, type MailConfig, type Mailer } from './types'

export const MAIL_CONFIG_KEY = 'mail.config'

export const getMailConfig = (settings: Settings): Promise<MailConfig | null> =>
  settings.getJson(MAIL_CONFIG_KEY, mailConfigSchema)

/** Credentials are stored encrypted. */
export async function setMailConfig(settings: Settings, config: MailConfig) {
  await settings.setJson(MAIL_CONFIG_KEY, mailConfigSchema.parse(config), { encrypted: true })
}

/** Returns null when the admin hasn't configured an email provider yet. */
export async function getMailer(settings: Settings): Promise<Mailer | null> {
  const config = await getMailConfig(settings)
  return config ? createMailer(config) : null
}
