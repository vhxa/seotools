import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendMail = vi.fn(async () => ({ messageId: '<smtp-1@test>' }))
const verify = vi.fn(async () => true)
const createTransport = vi.fn(() => ({ sendMail, verify }))
vi.mock('nodemailer', () => ({ default: { createTransport } }))

const resendSend = vi.fn()
const domainsList = vi.fn()
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resendSend }
    domains = { list: domainsList }
  },
}))

const { createMailer, getMailConfig, getMailer, mailConfigSchema, setMailConfig } =
  await import('./index')
const { createSettings } = await import('../settings')

beforeEach(() => vi.clearAllMocks())

const smtp = {
  provider: 'smtp' as const,
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  user: 'me',
  pass: 'pw',
  from: 'seotools <reports@example.com>',
}
const resend = { provider: 'resend' as const, apiKey: 're_123', from: 'reports@example.com' }

describe('mailConfigSchema', () => {
  it('discriminates on provider', () => {
    expect(mailConfigSchema.parse(smtp).provider).toBe('smtp')
    expect(mailConfigSchema.parse(resend).provider).toBe('resend')
    expect(() => mailConfigSchema.parse({ provider: 'smtp', from: 'x@y.z' })).toThrow()
    expect(() =>
      mailConfigSchema.parse({ provider: 'sendgrid', apiKey: 'k', from: 'x@y.z' }),
    ).toThrow()
  })
})

describe('smtp mailer (nodemailer)', () => {
  it('builds the transport from config and sends with the configured From', async () => {
    const mailer = createMailer(smtp)
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'me', pass: 'pw' },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    })
    const res = await mailer.send({ to: 'a@b.co', subject: 'Hi', text: 'hello' })
    expect(sendMail).toHaveBeenCalledWith({
      from: smtp.from,
      to: 'a@b.co',
      subject: 'Hi',
      text: 'hello',
    })
    expect(res).toEqual({ id: '<smtp-1@test>' })
  })

  it('omits auth for open relays and verifies the connection', async () => {
    const mailer = createMailer({ ...smtp, user: undefined, pass: undefined })
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }))
    await mailer.verify()
    expect(verify).toHaveBeenCalled()
  })

  it('refuses an empty message', async () => {
    await expect(createMailer(smtp).send({ to: 'a@b.co', subject: 'x' })).rejects.toThrow(
      /text.*html/,
    )
  })
})

describe('resend mailer', () => {
  it('sends and returns the message id', async () => {
    resendSend.mockResolvedValue({ data: { id: 're-1' }, error: null })
    const res = await createMailer(resend).send({ to: ['a@b.co'], subject: 'Hi', html: '<p>x</p>' })
    expect(resendSend).toHaveBeenCalledWith({
      from: resend.from,
      to: ['a@b.co'],
      subject: 'Hi',
      html: '<p>x</p>',
    })
    expect(res).toEqual({ id: 're-1' })
  })

  it('surfaces API errors', async () => {
    resendSend.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'bad from' },
    })
    await expect(
      createMailer(resend).send({ to: 'a@b.co', subject: 'Hi', text: 'x' }),
    ).rejects.toThrow(/bad from/)
  })

  it('accepts a send-only key when verifying', async () => {
    domainsList.mockResolvedValue({
      data: null,
      error: { name: 'restricted_api_key', message: 'restricted' },
    })
    await expect(createMailer(resend).verify()).resolves.toBeUndefined()
    domainsList.mockResolvedValue({
      data: null,
      error: { name: 'invalid_api_key', message: 'invalid' },
    })
    await expect(createMailer(resend).verify()).rejects.toThrow(/invalid/)
  })
})

describe('stored mail config', () => {
  it('is saved encrypted and rebuilt into a mailer', async () => {
    const rows = new Map<string, { value: string; encrypted: boolean }>()
    const settings = createSettings(
      {
        get: async (k) => rows.get(k) ?? null,
        set: async (k, value, encrypted) => void rows.set(k, { value, encrypted }),
        delete: async (k) => void rows.delete(k),
      },
      'k'.repeat(32),
    )

    expect(await getMailer(settings)).toBeNull()
    const config = { ...smtp, pass: 'hunter2-a-distinctive-smtp-password' }
    await setMailConfig(settings, config)

    const stored = rows.get('mail.config')!
    expect(stored.encrypted).toBe(true)
    // Long enough that a chance match inside the random base64 is impossible.
    expect(stored.value).not.toContain('hunter2')
    expect(await getMailConfig(settings)).toEqual(config)
    expect(await getMailer(settings)).not.toBeNull()
  })
})
