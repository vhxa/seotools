import { z } from '../zod'

export const smtpConfigSchema = z.object({
  provider: z.literal('smtp'),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  /** true = implicit TLS (usually port 465). false = STARTTLS when offered (587). */
  secure: z.boolean().default(false),
  user: z.string().optional(),
  pass: z.string().optional(),
  from: z.string().min(3),
})

export const resendConfigSchema = z.object({
  provider: z.literal('resend'),
  apiKey: z.string().min(1),
  from: z.string().min(3),
})

export const mailConfigSchema = z.discriminatedUnion('provider', [
  smtpConfigSchema,
  resendConfigSchema,
])

export type SmtpConfig = z.infer<typeof smtpConfigSchema>
export type ResendConfig = z.infer<typeof resendConfigSchema>
export type MailConfig = z.infer<typeof mailConfigSchema>

export interface MailMessage {
  to: string | string[]
  subject: string
  text?: string
  html?: string
}

export interface Mailer {
  send(message: MailMessage): Promise<{ id?: string }>
  /** Checks that the credentials / connection work, without sending anything. */
  verify(): Promise<void>
}
