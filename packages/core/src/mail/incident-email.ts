import { robotsChangeSummary } from '../incidents'
import type { AlertLocale } from '../alerts'
import type { IncidentKind, IncidentStage } from '../incidents'
import { alertLine } from './alert-email'
export const INCIDENT_EMAIL_COPY = {
  en: {
    stages: {
      open: 'Open',
      changed: 'Changed',
      'warn-14': 'Expires within 14 days',
      'warn-3': 'Expires within 3 days',
      expired: 'Expired',
      resolved: 'Recovered',
    },
    summary: {
      status: 'HTTP status',
      sitemapsAdded: 'Sitemaps added',
      sitemapsRemoved: 'Sitemaps removed',
      groupsAdded: 'User-agent groups added',
      groupsRemoved: 'User-agent groups removed',
      groupsChanged: 'User-agent groups changed',
    },
    'robots-unreachable': 'robots.txt could not be read',
    'robots-blocks-site': 'robots.txt now blocks the whole site for *',
    'robots-changed': 'robots.txt changed',
    'sitemap-broken': 'A sitemap could not be read or listed no URLs',
    'site-down': 'The site did not answer two checks an hour apart',
    certificate: 'The certificate needs attention',
    resolved: 'Recovered',
    daily: 'These checks run about once a day and are not an uptime monitor.',
    expires: 'The certificate expires on',
    vitals: 'Core Web Vitals: origin field data became poor',
  },
  es: {
    stages: {
      open: 'Abierta',
      changed: 'Cambio',
      'warn-14': 'Caduca en 14 días o menos',
      'warn-3': 'Caduca en 3 días o menos',
      expired: 'Caducado',
      resolved: 'Recuperado',
    },
    summary: {
      status: 'Estado HTTP',
      sitemapsAdded: 'Sitemaps añadidos',
      sitemapsRemoved: 'Sitemaps eliminados',
      groupsAdded: 'Grupos de agentes añadidos',
      groupsRemoved: 'Grupos de agentes eliminados',
      groupsChanged: 'Grupos de agentes modificados',
    },
    'robots-unreachable': 'No se pudo leer robots.txt',
    'robots-blocks-site': 'robots.txt ahora bloquea todo el sitio para *',
    'robots-changed': 'robots.txt ha cambiado',
    'sitemap-broken': 'No se pudo leer un sitemap o no contenía ninguna URL',
    'site-down': 'El sitio no respondió a dos comprobaciones separadas por una hora',
    certificate: 'El certificado requiere atención',
    resolved: 'Recuperado',
    daily:
      'Estas comprobaciones se realizan aproximadamente una vez al día y no son un monitor de disponibilidad.',
    expires: 'El certificado caduca el',
    vitals: 'Core Web Vitals: los datos de campo del origen han pasado a deficientes',
  },
} as const
export function incidentEmail(input: {
  locale: AlertLocale
  host: string
  kind: IncidentKind
  subject: string
  stage: IncidentStage
  at: Date
  details: string
  href: string
}) {
  const c = INCIDENT_EMAIL_COPY[input.locale]
  let details: { validTo?: unknown } = {}
  try {
    details = JSON.parse(input.details) as { validTo?: unknown }
  } catch {
    /* Older observations may have no details. */
  }
  return {
    subject: `${alertLine(input.host)}: ${input.stage === 'resolved' ? c.resolved : c[input.kind]}`,
    text: [
      c[input.kind],
      alertLine(input.subject),
      input.at.toISOString(),
      c.stages[input.stage],
      input.stage !== 'resolved' && typeof details.validTo === 'string'
        ? `${c.expires} ${alertLine(details.validTo)}`
        : '',
      input.kind === 'robots-changed'
        ? robotsChangeSummary(input.details)
            .map((row) => `${c.summary[row.key]}: ${alertLine(row.value, 500)}`)
            .join('\n')
        : '',
      c.daily,
      input.href,
    ]
      .filter(Boolean)
      .join('\n\n'),
  }
}
export function vitalsEmail(input: {
  locale: AlertLocale
  host: string
  regressions: string[]
  href: string
}) {
  const c = INCIDENT_EMAIL_COPY[input.locale]
  return {
    subject: `${alertLine(input.host)}: ${c.vitals}`,
    text: [c.vitals, ...input.regressions.map((r) => alertLine(r)), input.href].join('\n\n'),
  }
}
