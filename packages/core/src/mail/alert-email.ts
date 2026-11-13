import type { AlertKind, AlertLocale } from '../alerts'
import { sortedAlertKinds } from '../alerts'

/**
 * The emails about a crawl, and the test email. The worker sends them, away from the web app's
 * message catalogs, so their copy lives here in the same two languages (a test keeps both with the
 * same keys). Plain text on purpose: what a site says (URLs, errors) goes in as text and is cut and
 * stripped of control characters, never interpreted.
 */
export const ALERT_EMAIL_COPY = {
  en: {
    testSubject: 'Test email from seotools',
    testBody: 'This is a test email from seotools. If you are reading it, the email settings work.',
    subjectFailed: '{host}: the crawl failed',
    subjectIncomplete: '{host}: the crawl is incomplete',
    subjectFindings: '{host}: new important findings',
    subjectSummary: '{host}: changes since the previous crawl',
    subjectMerged: '{host}: {parts}',
    partProblem: 'crawl problem',
    partFindings: 'new important findings',
    partSummary: 'changes',
    intro: 'The crawl of {host} finished on {date}.',
    open: 'Open: {link}',
    problemTitle: 'Crawl problem',
    problemFailed: 'The crawl failed and has no results.',
    problemReason: 'Reason: {error}',
    browserUnavailable: 'The rendering browser was unavailable for the crawl’s recovery limit.',
    problemIncomplete:
      'The crawl stopped at its limit of URLs before it reached the whole site. Pages: {pages}. URLs found: {urls}.',
    problemHint: 'Raise the limit in the crawl settings, or narrow what is crawled.',
    findingsTitle: 'New important findings',
    findingsIntro:
      'These findings of high importance were not in the crawl of {since}, and are now:',
    findingsRow: '- {name}: {count} ({fresh} new, {back} back)',
    findingsMore: '… and {count} more issues. Open the comparison for the rest.',
    findingsCut: 'The list was cut: there are more than these.',
    findingsNote:
      'Findings that changed because the audit rules or the checks changed are not listed here.',
    summaryTitle: 'Changes since the crawl of {since}',
    summaryFirst:
      'This is the first crawl of {host} with results: {pages} pages. Changes are reported from the next one.',
    summaryNoBase:
      'There is no earlier crawl that completed and still has its results, so the two cannot be compared.',
    summaryUrls: 'URLs added: {added}. URLs not seen: {missing}.',
    summaryAnswers:
      'Answers that changed: status {status}, title {title}, canonical {canonical}, robots {robots}.',
    summaryFindings:
      'Findings: {fresh} new, {back} back, {resolved} resolved, {unverified} unverified.',
    summaryFindingsOther:
      'Also: {accepted} accepted by a rule, {excluded} left out of the audit, {audited} now audited.',
    summaryNoFindings: 'Findings cannot be compared: one of the crawls has none.',
    summaryCut: 'Large changes were counted up to a limit: the real numbers are higher.',
    noteIgnoredParameters:
      'Ignored query parameters changed: added and not seen URLs may come from this setting.',
    noteIncomplete: 'A crawl stopped at its URL limit, so URLs it did not reach are not gone.',
    noteCatalog: 'The checks changed between the two crawls: some findings differ because of that.',
    noteAudit:
      'The audit rules changed between the two crawls: findings that differ because of them are unverified, not new or resolved.',
    noteLegacy: 'An older crawl did not keep which URLs were audited.',
    noteUnanalysed: 'A crawl has no findings.',
    notePruned: 'A crawl no longer has its results.',
    compare: 'Compare the two crawls: {link}',
  },
  es: {
    testSubject: 'Correo de prueba de seotools',
    testBody:
      'Este es un correo de prueba de seotools. Si lo estás leyendo, la configuración de correo funciona.',
    subjectFailed: '{host}: el rastreo ha fallado',
    subjectIncomplete: '{host}: el rastreo está incompleto',
    subjectFindings: '{host}: nuevos hallazgos importantes',
    subjectSummary: '{host}: cambios desde el rastreo anterior',
    subjectMerged: '{host}: {parts}',
    partProblem: 'problema de rastreo',
    partFindings: 'nuevos hallazgos importantes',
    partSummary: 'cambios',
    intro: 'El rastreo de {host} terminó el {date}.',
    open: 'Abrir: {link}',
    problemTitle: 'Problema de rastreo',
    problemFailed: 'El rastreo ha fallado y no tiene resultados.',
    problemReason: 'Motivo: {error}',
    browserUnavailable:
      'El navegador de renderizado no estuvo disponible durante el plazo de recuperación del rastreo.',
    problemIncomplete:
      'El rastreo se detuvo en su límite de URLs antes de llegar a todo el sitio. Páginas: {pages}. URLs encontradas: {urls}.',
    problemHint: 'Sube el límite en los ajustes de rastreo, o acota lo que se rastrea.',
    findingsTitle: 'Nuevos hallazgos importantes',
    findingsIntro:
      'Estos hallazgos de importancia alta no estaban en el rastreo del {since}, y ahora sí:',
    findingsRow: '- {name}: {count} ({fresh} nuevos, {back} de vuelta)',
    findingsMore: '… y {count} problemas más. Abre la comparación para ver el resto.',
    findingsCut: 'La lista se ha cortado: hay más que estos.',
    findingsNote:
      'No se listan los hallazgos que cambian porque cambiaron las reglas de auditoría o las comprobaciones.',
    summaryTitle: 'Cambios desde el rastreo del {since}',
    summaryFirst:
      'Este es el primer rastreo de {host} con resultados: {pages} páginas. Los cambios se avisan desde el siguiente.',
    summaryNoBase:
      'No hay un rastreo anterior que se completara y conserve sus resultados, así que no se pueden comparar.',
    summaryUrls: 'URLs nuevas: {added}. URLs no vistas: {missing}.',
    summaryAnswers:
      'Respuestas que cambiaron: estado {status}, título {title}, canónica {canonical}, robots {robots}.',
    summaryFindings:
      'Hallazgos: {fresh} nuevos, {back} de vuelta, {resolved} resueltos, {unverified} sin verificar.',
    summaryFindingsOther:
      'Además: {accepted} aceptados por una regla, {excluded} fuera de la auditoría, {audited} ahora auditados.',
    summaryNoFindings: 'No se pueden comparar los hallazgos: uno de los rastreos no tiene.',
    summaryCut: 'Los cambios grandes se contaron hasta un límite: las cifras reales son mayores.',
    noteIgnoredParameters:
      'Han cambiado los parámetros ignorados: las URL añadidas y no vistas pueden deberse a este ajuste.',
    noteIncomplete:
      'Un rastreo se detuvo en su límite de URLs, así que las URLs que no alcanzó no han desaparecido.',
    noteCatalog:
      'Las comprobaciones cambiaron entre los dos rastreos: algunos hallazgos difieren por eso.',
    noteAudit:
      'Las reglas de auditoría cambiaron entre los dos rastreos: los hallazgos que difieren por ellas están sin verificar, no son nuevos ni resueltos.',
    noteLegacy: 'Un rastreo antiguo no guardó qué URLs se auditaron.',
    noteUnanalysed: 'Un rastreo no tiene hallazgos.',
    notePruned: 'Un rastreo ya no conserva sus resultados.',
    compare: 'Comparar los dos rastreos: {link}',
  },
} as const

export type AlertEmailCopy = Record<keyof (typeof ALERT_EMAIL_COPY)['en'], string>

/** The most that is listed of anything that comes from a site or a provider. */
export const MAX_ALERT_ISSUES = 10
export const MAX_ALERT_SAMPLES = 3
const MAX_LINE = 200

/** What a site or a provider said, as one short line of plain text. */
export function alertLine(value: string, max = MAX_LINE): string {
  const line = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export interface FindingGroup {
  /** Shown as it is: the name of the issue in the language of the email. */
  name: string
  /** URLs with the finding. */
  count: number
  fresh: number
  back: number
  /** A few of them. */
  samples: string[]
  href: string
}

export interface FindingsNotice {
  since: Date
  /** Worst first. At most `MAX_ALERT_ISSUES` are shown. */
  groups: FindingGroup[]
  /** Counting stopped at a limit. */
  cut: boolean
  compareHref: string
}

export type PairNoteName =
  'ignoredParameters' | 'incomplete' | 'catalog' | 'audit' | 'legacy' | 'unanalysed' | 'pruned'

export type ChangeSummary =
  | { state: 'first'; pages: number }
  | { state: 'no-base' }
  | {
      state: 'compared'
      since: Date
      urls: {
        added: number
        missing: number
        status: number
        title: number
        canonical: number
        robots: number
      }
      /** `null`: the crawls cannot be compared on findings. */
      findings: {
        fresh: number
        back: number
        resolved: number
        unverified: number
        accepted: number
        excluded: number
        audited: number
      } | null
      notes: PairNoteName[]
      cut: boolean
      compareHref: string
    }

export interface AlertEmailInput {
  locale: AlertLocale
  host: string
  /** The sections this email carries, in any order. */
  kinds: readonly AlertKind[]
  crawl: {
    status: 'completed' | 'incomplete' | 'failed'
    finishedAt: Date
    error: string | null
    pages: number
    urls: number
  }
  links: { history: string; crawlSettings: string }
  findings?: FindingsNotice
  summary?: ChangeSummary
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''))

const NOTE_COPY = {
  ignoredParameters: 'noteIgnoredParameters',
  incomplete: 'noteIncomplete',
  catalog: 'noteCatalog',
  audit: 'noteAudit',
  legacy: 'noteLegacy',
  unanalysed: 'noteUnanalysed',
  pruned: 'notePruned',
} as const satisfies Record<PairNoteName, keyof AlertEmailCopy>

const dateOf = (date: Date, locale: AlertLocale) =>
  `${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date)} UTC`

/** The email about one finished crawl: one section for each kind the person asked for and has news. */
export function alertEmail(input: AlertEmailInput): { subject: string; text: string } {
  const copy: AlertEmailCopy = ALERT_EMAIL_COPY[input.locale]
  const host = alertLine(input.host)
  const kinds = sortedAlertKinds(input.kinds)
  const date = (value: Date) => dateOf(value, input.locale)
  const sections: string[] = []

  if (kinds.includes('crawl-problem')) {
    const lines = [copy.problemTitle]
    if (input.crawl.status === 'failed') {
      lines.push(copy.problemFailed)
      if (input.crawl.error) {
        lines.push(
          fill(copy.problemReason, {
            error:
              input.crawl.error === 'browser-unavailable'
                ? copy.browserUnavailable
                : alertLine(input.crawl.error),
          }),
        )
      }
      lines.push(fill(copy.open, { link: input.links.history }))
    } else {
      lines.push(fill(copy.problemIncomplete, { pages: input.crawl.pages, urls: input.crawl.urls }))
      lines.push(copy.problemHint)
      lines.push(fill(copy.open, { link: input.links.crawlSettings }))
    }
    sections.push(lines.join('\n'))
  }

  if (kinds.includes('important-findings') && input.findings) {
    const { findings } = input
    const lines = [copy.findingsTitle, fill(copy.findingsIntro, { since: date(findings.since) })]
    for (const group of findings.groups.slice(0, MAX_ALERT_ISSUES)) {
      lines.push(
        '',
        fill(copy.findingsRow, {
          name: alertLine(group.name),
          count: group.count,
          fresh: group.fresh,
          back: group.back,
        }),
      )
      for (const url of group.samples.slice(0, MAX_ALERT_SAMPLES))
        lines.push(`    ${alertLine(url)}`)
      lines.push(`    ${fill(copy.open, { link: group.href })}`)
    }
    lines.push('')
    if (findings.groups.length > MAX_ALERT_ISSUES) {
      lines.push(fill(copy.findingsMore, { count: findings.groups.length - MAX_ALERT_ISSUES }))
    }
    if (findings.cut) lines.push(copy.findingsCut)
    lines.push(copy.findingsNote, fill(copy.compare, { link: findings.compareHref }))
    sections.push(lines.join('\n'))
  }

  if (kinds.includes('change-summary') && input.summary) {
    const { summary } = input
    const lines: string[] = []
    if (summary.state === 'first') {
      lines.push(fill(copy.summaryFirst, { host, pages: summary.pages }))
    } else if (summary.state === 'no-base') {
      lines.push(copy.summaryNoBase)
    } else {
      lines.push(fill(copy.summaryTitle, { since: date(summary.since) }))
      const { urls, findings } = summary
      lines.push(fill(copy.summaryUrls, urls))
      lines.push(fill(copy.summaryAnswers, urls))
      if (findings) {
        lines.push(fill(copy.summaryFindings, findings))
        if (findings.accepted + findings.excluded + findings.audited > 0) {
          lines.push(fill(copy.summaryFindingsOther, findings))
        }
      } else {
        lines.push(copy.summaryNoFindings)
      }
      for (const note of summary.notes) lines.push(copy[NOTE_COPY[note]])
      if (summary.cut) lines.push(copy.summaryCut)
      lines.push(fill(copy.compare, { link: summary.compareHref }))
    }
    sections.push(lines.join('\n'))
  }

  const text = `${fill(copy.intro, { host, date: date(input.crawl.finishedAt) })}\n\n${sections.join('\n\n')}\n`
  return { subject: subjectOf(copy, host, kinds, input.crawl.status), text }
}

function subjectOf(
  copy: AlertEmailCopy,
  host: string,
  kinds: readonly AlertKind[],
  status: AlertEmailInput['crawl']['status'],
): string {
  if (kinds.length === 1) {
    if (kinds[0] === 'crawl-problem') {
      return fill(status === 'failed' ? copy.subjectFailed : copy.subjectIncomplete, { host })
    }
    return fill(kinds[0] === 'important-findings' ? copy.subjectFindings : copy.subjectSummary, {
      host,
    })
  }
  const parts = kinds.map((kind) =>
    kind === 'crawl-problem'
      ? copy.partProblem
      : kind === 'important-findings'
        ? copy.partFindings
        : copy.partSummary,
  )
  return fill(copy.subjectMerged, { host, parts: parts.join(', ') })
}

/** The email an administrator sends to see that the settings work. */
export function testEmail(locale: AlertLocale): { subject: string; text: string } {
  const copy = ALERT_EMAIL_COPY[locale]
  return { subject: copy.testSubject, text: `${copy.testBody}\n` }
}

/** The address of a page of the app, from its public address. */
export const appLink = (publicUrl: string, path: string) => `${publicUrl.replace(/\/$/, '')}${path}`
