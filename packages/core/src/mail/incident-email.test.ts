import { expect, it } from 'vitest'
import { INCIDENT_EMAIL_COPY, incidentEmail, vitalsEmail } from './incident-email'
it('keeps both languages complete and bounds site-controlled email text', () => {
  expect(Object.keys(INCIDENT_EMAIL_COPY.en).sort()).toEqual(
    Object.keys(INCIDENT_EMAIL_COPY.es).sort(),
  )
  expect(Object.keys(INCIDENT_EMAIL_COPY.en.stages).sort()).toEqual(
    Object.keys(INCIDENT_EMAIL_COPY.es.stages).sort(),
  )
  for (const locale of ['en', 'es'] as const) {
    const mail = incidentEmail({
      locale,
      host: 'example.com\r\nInjected: value',
      kind: 'certificate',
      subject: 'https://example.com/\nInjected',
      stage: 'expired',
      at: new Date('2026-01-01'),
      details: JSON.stringify({ validTo: '2025-12-31\nInjected' }),
      href: 'https://seo.example.com/domains/example.com/issues',
    })
    expect(mail.subject).not.toContain('\n')
    expect(mail.text).toContain(INCIDENT_EMAIL_COPY[locale].stages.expired)
    expect(mail.text?.split(INCIDENT_EMAIL_COPY[locale].daily)).toHaveLength(2)
    expect(mail.text).not.toContain('\nInjected')
    expect(
      vitalsEmail({
        locale,
        host: 'example.com',
        regressions: ['PHONE: LCP 2000 → 5000'],
        href: 'https://seo.example.com',
      }).text,
    ).toContain('LCP')
  }
})
