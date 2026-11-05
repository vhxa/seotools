import type { MailConfig } from '@seotools/core'
import { describe, expect, it } from 'vitest'
import { parseMailForm, secretsOf, viewOf } from './mail-config'

const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}
const smtp: MailConfig = {
  provider: 'smtp',
  host: 'smtp.acme.com',
  port: 587,
  secure: false,
  user: 'mailer',
  pass: 'hunter2',
  from: 'seo@acme.com',
}

describe('the email form', () => {
  it('never shows a secret, only that there is one', () => {
    const view = viewOf(smtp)
    expect(view).toMatchObject({ provider: 'smtp', user: 'mailer', hasPassword: true })
    expect(JSON.stringify(view)).not.toContain('hunter2')
    const resend = viewOf({ provider: 'resend', apiKey: 're_secretsecret', from: 'a@b.co' })
    expect(resend).toEqual({ provider: 'resend', from: 'a@b.co', hasApiKey: true })
    expect(JSON.stringify(resend)).not.toContain('secret')
    expect(viewOf(null)).toBeNull()
  })

  it('keeps the stored secret when it is left blank, and replaces it when typed', () => {
    const base = {
      provider: 'smtp',
      host: 'smtp.acme.com',
      port: '587',
      user: 'mailer',
      from: 'seo@acme.com',
    }
    expect(parseMailForm(form({ ...base, pass: '' }), smtp)).toMatchObject({
      ok: true,
      config: { pass: 'hunter2' },
    })
    expect(parseMailForm(form({ ...base, pass: 'new' }), smtp)).toMatchObject({
      ok: true,
      config: { pass: 'new' },
    })
    // Without a username there is no password to keep.
    const open = parseMailForm(form({ ...base, user: '', pass: '' }), smtp)
    expect(open).toMatchObject({ ok: true })
    expect(open.ok && open.config).not.toHaveProperty('pass')
    expect(open.ok && open.config).not.toHaveProperty('user')
  })

  it('keeps the stored Resend key only for Resend', () => {
    const stored: MailConfig = { provider: 'resend', apiKey: 're_stored', from: 'a@b.co' }
    expect(
      parseMailForm(form({ provider: 'resend', from: 'a@b.co', apiKey: '' }), stored),
    ).toMatchObject({
      ok: true,
      config: { apiKey: 're_stored' },
    })
    expect(parseMailForm(form({ provider: 'resend', from: 'a@b.co', apiKey: '' }), smtp)).toEqual({
      ok: false,
      error: 'apiKey',
    })
  })

  it('refuses what cannot work', () => {
    const base = { provider: 'smtp', host: 'smtp.acme.com', port: '587', from: 'seo@acme.com' }
    expect(parseMailForm(form({ ...base, provider: 'x' }), null)).toEqual({
      ok: false,
      error: 'provider',
    })
    expect(parseMailForm(form({ ...base, host: ' ' }), null)).toEqual({ ok: false, error: 'host' })
    expect(parseMailForm(form({ ...base, host: 'smtp://acme' }), null)).toEqual({
      ok: false,
      error: 'host',
    })
    for (const port of ['0', '70000', 'abc', '5.5', '']) {
      expect(parseMailForm(form({ ...base, port }), null)).toEqual({ ok: false, error: 'port' })
    }
    expect(parseMailForm(form({ ...base, from: 'nobody' }), null)).toEqual({
      ok: false,
      error: 'from',
    })
  })

  it('knows the secrets to take out of an error', () => {
    expect(secretsOf(smtp)).toEqual(['hunter2'])
    expect(secretsOf({ provider: 'resend', apiKey: 'k', from: 'a@b.co' })).toEqual(['k'])
  })
})
