import {
  MAIL_PAUSED,
  MAIL_UNDECRYPTABLE,
  createLogger,
  unavailableMailer,
  type Mailer,
} from '@seotools/core'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deliver } from './deliver'

const log = createLogger('test', 'silent')
let db: Database
beforeEach(async () => {
  db = await createTestDatabase()
})
afterEach(async () => {
  await db.close()
})

const input = (
  mailer: Mailer | null,
  content = vi.fn(async () => ({ subject: 's', text: 't' })),
) => ({
  db,
  log,
  mailer,
  kind: 'invite' as const,
  to: 'ana@example.com',
  content,
})

describe('deliver with a mailer that cannot send', () => {
  it('records paused automation as not sent, makes no content and does not retry', async () => {
    const args = input(unavailableMailer(MAIL_PAUSED, { retry: false }))
    await expect(deliver(args)).resolves.toEqual({})
    expect(args.content).not.toHaveBeenCalled()
    const [row] = await db.mail.recent({ limit: 5 })
    expect(row).toMatchObject({ status: 'unconfigured', error: MAIL_PAUSED })
  })

  it('records undecryptable settings as not sent with a bounded error, and is retried', async () => {
    const args = input(unavailableMailer(MAIL_UNDECRYPTABLE))
    await expect(deliver(args)).rejects.toThrow(MAIL_UNDECRYPTABLE)
    expect(args.content).not.toHaveBeenCalled()
    const [row] = await db.mail.recent({ limit: 5 })
    expect(row).toMatchObject({ status: 'unconfigured', error: MAIL_UNDECRYPTABLE })
    expect(row!.error!.length).toBeLessThan(200)
  })

  it('still records a provider failure as failed', async () => {
    const mailer = { send: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as Mailer
    await expect(deliver(input(mailer))).rejects.toThrow('boom')
    expect((await db.mail.recent({ limit: 1 }))[0]).toMatchObject({ status: 'failed' })
  })
})
