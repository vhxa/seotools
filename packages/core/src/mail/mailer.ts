import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import type { MailConfig, MailMessage, Mailer, ResendConfig, SmtpConfig } from './types'

function assertBody(message: MailMessage) {
  if (!message.text && !message.html) throw new Error('Mail message needs `text` or `html`')
}

export function createSmtpMailer(config: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass ?? '' } : undefined,
  })
  return {
    async send(message) {
      assertBody(message)
      const info = await transport.sendMail({ from: config.from, ...message })
      return { id: info.messageId }
    },
    async verify() {
      await transport.verify()
    },
  }
}

export function createResendMailer(config: ResendConfig): Mailer {
  const client = new Resend(config.apiKey)
  return {
    async send(message) {
      assertBody(message)
      const { data, error } = await client.emails.send({
        from: config.from,
        to: message.to,
        subject: message.subject,
        // Resend requires at least one of text/html; the check above guarantees it.
        ...(message.html ? { html: message.html } : {}),
        ...(message.text ? { text: message.text } : {}),
      } as Parameters<typeof client.emails.send>[0])
      if (error) throw new Error(`Resend error: ${error.message}`)
      return { id: data?.id }
    },
    async verify() {
      // Listing API keys needs a full-access key; domains is readable by sending keys too.
      const { error } = await client.domains.list()
      if (error && error.name !== 'restricted_api_key') {
        throw new Error(`Resend error: ${error.message}`)
      }
    },
  }
}

export function createMailer(config: MailConfig): Mailer {
  return config.provider === 'smtp' ? createSmtpMailer(config) : createResendMailer(config)
}
