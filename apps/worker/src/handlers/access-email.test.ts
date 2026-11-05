import { createLogger, setPasswordLink, type Job, type Mailer } from '@seotools/core'
import { createFirstAdmin, hashUserToken, inviteUser, redeemUserToken } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PermanentJobError, type HandlerContext } from '../types'
import { createAccessEmailHandler } from './access-email'

const PUBLIC_URL = 'https://seo.example.com'

let db: Database
let userId: string
let sent: { to: string | string[]; text?: string | undefined; subject: string }[]
const mailer: Mailer = {
  send: vi.fn(async (message) => {
    sent.push(message)
    return { id: 'm1' }
  }),
} as unknown as Mailer
const context = (withMailer: Mailer | null = mailer): HandlerContext => ({
  log: createLogger('test', 'silent'),
  signal: new AbortController().signal,
  getMailer: async () => withMailer,
})
const job = (payload: unknown) => ({ payload }) as Job
const handler = () => createAccessEmailHandler({ db, publicUrl: PUBLIC_URL })

beforeEach(async () => {
  db = await createTestDatabase()
  sent = []
  await createFirstAdmin(db, { email: 'a@example.com', name: 'A', password: 'a-long-password' })
  const invited = await inviteUser(db, {
    name: 'Ana',
    email: 'ana@example.com',
    role: 'member',
    grants: [],
  })
  if (!invited.ok) throw new Error(invited.reason)
  userId = invited.user.id
})
afterEach(async () => {
  await db.close()
})

describe('the email with a link to set a password', () => {
  it('goes to the account, in its language, with a link that works, and no job holds it', async () => {
    const payload = { userId, kind: 'invite', locale: 'es' }
    await handler()(job(payload), context())
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: 'ana@example.com', subject: 'Te han invitado a seotools' })
    const token = /token=([^\s]+)/.exec(sent[0]!.text ?? '')?.[1]
    expect(token).toBeTruthy()
    expect(sent[0]!.text).toContain(setPasswordLink(PUBLIC_URL, decodeURIComponent(token!)))
    expect(JSON.stringify(payload)).not.toContain(token!)
    expect(
      await db.users.findToken(hashUserToken(decodeURIComponent(token!)), new Date()),
    ).toMatchObject({ kind: 'invite' })
    expect(
      await redeemUserToken(db, { token: decodeURIComponent(token!), password: 'a-long-password' }),
    ).toBe(true)
  })

  it('records every attempt, with who it went to and what the provider said, and never the link', async () => {
    await handler()(job({ userId, kind: 'invite', locale: 'en' }), context())
    const failing: Mailer = {
      send: vi.fn(async () => {
        throw new Error('535 login failed for https://seo.example.com/set-password?token=abc123')
      }),
    } as unknown as Mailer
    await expect(
      handler()(job({ userId, kind: 'reset', locale: 'en' }), context(failing)),
    ).rejects.toThrow('login failed')

    const deliveries = await db.mail.recent({ limit: 10 })
    expect(deliveries.map((d) => [d.kind, d.recipient, d.status])).toEqual([
      ['reset', 'ana@example.com', 'failed'],
      ['invite', 'ana@example.com', 'sent'],
    ])
    expect(deliveries[0]!.error).toContain('login failed')
    expect(JSON.stringify(deliveries)).not.toMatch(/abc123|set-password|token=/)
  })

  it('is retried while no email provider is set, and spends no link', async () => {
    await expect(
      handler()(job({ userId, kind: 'reset', locale: 'en' }), context(null)),
    ).rejects.toThrow('No email provider')
    expect(sent).toEqual([])
    expect(await db.mail.recent({ limit: 5 })).toMatchObject([
      { kind: 'reset', status: 'unconfigured', recipient: 'ana@example.com' },
    ])
  })

  it('is not sent to an account disabled since, or gone', async () => {
    await db.users.setDisabled(userId, true)
    expect(await handler()(job({ userId, kind: 'reset', locale: 'en' }), context())).toEqual({
      skipped: true,
    })
    expect(
      await handler()(job({ userId: 'gone', kind: 'reset', locale: 'en' }), context()),
    ).toEqual({
      skipped: true,
    })
    expect(sent).toEqual([])
  })

  it('fails for good when it cannot be right', async () => {
    await expect(handler()(job({ userId, kind: 'other' }), context())).rejects.toBeInstanceOf(
      PermanentJobError,
    )
    await expect(
      createAccessEmailHandler({ db, publicUrl: undefined })(
        job({ userId, kind: 'reset', locale: 'en' }),
        context(),
      ),
    ).rejects.toBeInstanceOf(PermanentJobError)
  })
})
