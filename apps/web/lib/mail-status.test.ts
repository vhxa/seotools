import type { MailDelivery } from '@seotools/db'
import { describe, expect, it } from 'vitest'
import { mailHealth } from './mail-status'

const delivery = (status: MailDelivery['status']): MailDelivery => ({
  id: 'd',
  kind: 'alert',
  recipient: 'a@b.co',
  status,
  error: status === 'sent' ? null : 'x',
  createdAt: new Date(),
})

describe('mailHealth', () => {
  it('is fine with nothing sent or the latest sent', () => {
    expect(mailHealth({ configured: false, latest: null })).toEqual({ state: 'ok' })
    expect(mailHealth({ configured: true, latest: delivery('sent') })).toEqual({ state: 'ok' })
  })

  it('warns when the latest delivery failed, even with a provider', () => {
    expect(mailHealth({ configured: true, latest: delivery('failed') })).toEqual({
      state: 'failing',
    })
  })

  it('warns that nothing is configured only while that is so', () => {
    expect(mailHealth({ configured: false, latest: delivery('unconfigured') })).toEqual({
      state: 'unconfigured',
    })
    expect(mailHealth({ configured: true, latest: delivery('unconfigured') })).toEqual({
      state: 'ok',
    })
  })
})
