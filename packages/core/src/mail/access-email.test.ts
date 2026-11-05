import { describe, expect, it } from 'vitest'
import { ACCESS_EMAIL_COPY, accessEmail, setPasswordLink } from './access-email'

describe('accessEmail', () => {
  it('has the same copy in every language', () => {
    const shape = (locale: keyof typeof ACCESS_EMAIL_COPY) =>
      Object.entries(ACCESS_EMAIL_COPY[locale]).map(([kind, copy]) => [kind, Object.keys(copy)])
    expect(shape('es')).toEqual(shape('en'))
  })

  it('carries the link and how long it works', () => {
    const link = 'https://seo.example.com/set-password?token=abc'
    const { subject, text } = accessEmail({
      kind: 'reset',
      locale: 'es',
      link,
      ttlMs: 60 * 60_000,
    })
    expect(subject).toContain('contraseña')
    expect(text).toContain(link)
    expect(text).toContain('1 horas')
  })
})

describe('setPasswordLink', () => {
  it('joins the address of the app and encodes the token', () => {
    expect(setPasswordLink('https://seo.example.com/', 'a+b/c')).toBe(
      'https://seo.example.com/set-password?token=a%2Bb%2Fc',
    )
  })
})
