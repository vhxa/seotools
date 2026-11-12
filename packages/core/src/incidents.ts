import { parseRobots, robotsAccess } from './crawl/robots'
import { isDefaultSitemapUrl } from './crawl/files'
import type { CrawlFile } from './crawl-file-views'

type IncidentFile = Omit<CrawlFile, 'domainId' | 'urlHash' | 'via'>

export const INCIDENT_KINDS = [
  'robots-unreachable',
  'robots-blocks-site',
  'robots-changed',
  'sitemap-broken',
  'site-down',
  'certificate',
] as const
export type IncidentKind = (typeof INCIDENT_KINDS)[number]
export const INCIDENT_STAGES = [
  'open',
  'changed',
  'warn-14',
  'warn-3',
  'expired',
  'resolved',
] as const
export type IncidentStage = (typeof INCIDENT_STAGES)[number]
export interface IncidentObservation {
  kind: IncidentKind
  subject: string
  stage: IncidentStage
  details: string
}
export interface IncidentCheck {
  outcome: string | null
  checkedAt: Date | null
}
export interface ActiveIncident extends IncidentObservation {
  id: string
}
const answered = (f: IncidentFile) =>
  f.statusCode !== null && (f.statusCode < 300 || (f.statusCode >= 400 && f.statusCode < 500))
const normalized = (body: string | null) =>
  (body ?? '')
    .split(/\r?\n/)
    .map((l) => (l.split('#')[0] ?? '').trim().replace(/\s*:\s*/, ':'))
    .filter(Boolean)
    .join('\n')
function robotsSummary(before: IncidentFile, after: IncidentFile): string {
  const a = parseRobots(before.body ?? ''),
    b = parseRobots(after.body ?? '')
  const groups = (p: typeof a) =>
    new Map(
      p.groups.flatMap((g) =>
        g.userAgents.map(
          (token) =>
            [
              token.toLowerCase(),
              JSON.stringify({ rules: g.rules, crawlDelay: g.crawlDelay }),
            ] as const,
        ),
      ),
    )
  const x = groups(a),
    y = groups(b)
  const cut = (values: string[]) => values.slice(0, 6).map((v) => v.slice(0, 80))
  const summary = {
    status: [before.statusCode, after.statusCode],
    sitemapsAdded: cut(b.sitemaps.filter((s) => !a.sitemaps.includes(s))),
    sitemapsRemoved: cut(a.sitemaps.filter((s) => !b.sitemaps.includes(s))),
    groupsAdded: cut([...y.keys()].filter((s) => !x.has(s))),
    groupsRemoved: cut([...x.keys()].filter((s) => !y.has(s))),
    groupsChanged: cut([...y.keys()].filter((s) => x.has(s) && x.get(s) !== y.get(s))),
  }
  const lists = [
    summary.sitemapsAdded,
    summary.sitemapsRemoved,
    summary.groupsAdded,
    summary.groupsRemoved,
    summary.groupsChanged,
  ]
  while (new TextEncoder().encode(JSON.stringify(summary)).length > 4000) {
    lists.sort((a, b) => b.join('').length - a.join('').length)[0]?.pop()
  }
  return JSON.stringify(summary)
}
/** Pure observations; active incidents preserve the baseline decision on subsequent checks. */
export function detectIncidents(input: {
  origin: string
  previous: IncidentFile[]
  files: IncidentFile[]
  previousCheck: IncidentCheck | null
  check?: IncidentCheck
  active: ActiveIncident[]
  now: Date
}) {
  const { origin, previous, files, active, now } = input
  const open: IncidentObservation[] = [],
    resolve: ActiveIncident[] = [],
    escalate: (IncidentObservation & { id: string })[] = []
  const state = (
    kind: IncidentKind,
    subject: string,
    bad: boolean,
    baseline: boolean,
    stage: IncidentStage = 'open',
    details = '{}',
  ) => {
    const existing = active.find((i) => i.kind === kind && i.subject === subject)
    if (bad && existing) {
      const rank = ['warn-14', 'warn-3', 'expired']
      escalate.push({
        ...existing,
        details,
        stage: rank.indexOf(stage) > rank.indexOf(existing.stage) ? stage : existing.stage,
      })
    } else if (bad && !baseline) open.push({ kind, subject, stage, details })
    else if (!bad && existing) resolve.push(existing)
  }
  const robot = files.find((f) => f.url === new URL('robots.txt', origin).href)
  if (robot) {
    const old = previous.find((f) => f.url === robot.url)
    if (files.some((f) => f.statusCode !== null)) {
      state(
        'robots-unreachable',
        robot.url,
        robot.statusCode === null || robot.statusCode >= 500,
        !old || !answered(old),
      )
    }
    if (answered(robot)) {
      const blocked = (f: IncidentFile) =>
        f.body !== null && robotsAccess(parseRobots(f.body), '*').access === 'blocked'
      state('robots-blocks-site', robot.url, blocked(robot), !old || blocked(old))
      if (
        old &&
        answered(old) &&
        (old.statusCode !== robot.statusCode || normalized(old.body) !== normalized(robot.body))
      )
        open.push({
          kind: 'robots-changed',
          subject: robot.url,
          stage: 'changed',
          details: robotsSummary(old, robot),
        })
    }
    const expiry = robot.data?.tls?.validTo
    const expiredError = robot.error?.startsWith('CERT_HAS_EXPIRED:') ?? false
    if (expiry || expiredError) {
      const days = expiry ? (new Date(expiry).getTime() - now.getTime()) / 86400000 : -1
      state(
        'certificate',
        origin,
        days <= 14,
        false,
        days < 0 ? 'expired' : days <= 3 ? 'warn-3' : 'warn-14',
        JSON.stringify({ validTo: expiry ?? null }),
      )
    }
  }
  const declared = new Set(
    files
      .filter((f) => f.kind === 'robots')
      .flatMap((f) =>
        parseRobots(f.body ?? '').sitemaps.map((s) => {
          try {
            return new URL(s, f.url).href
          } catch {
            return ''
          }
        }),
      ),
  )
  for (const f of files.filter(
    (f) => f.kind === 'sitemap' && (declared.has(f.url) || isDefaultSitemapUrl(f.url)),
  )) {
    const old = previous.find((p) => p.url === f.url)
    const lists = (p: IncidentFile) => p.statusCode === 200 && (p.data?.sitemap?.entries ?? 0) > 0
    state('sitemap-broken', f.url, !lists(f), !old || !lists(old))
  }
  if (input.check) {
    const tlsError = files.some(
      (f) => f.error && /CERT_|TLS_|SSL_|SELF_SIGNED|UNABLE_TO_VERIFY/.test(f.error),
    )
    const previousCheck = input.previousCheck
    if (input.check.outcome === 'ok') state('site-down', origin, false, false)
    else if (
      !tlsError &&
      previousCheck?.outcome === 'unreachable' &&
      previousCheck.checkedAt &&
      input.check.checkedAt &&
      input.check.checkedAt.getTime() - previousCheck.checkedAt.getTime() >= 3600000
    )
      state('site-down', origin, true, false)
  }
  return { open, resolve, escalate }
}

export const ROBOTS_CHANGE_FIELDS = [
  'status',
  'sitemapsAdded',
  'sitemapsRemoved',
  'groupsAdded',
  'groupsRemoved',
  'groupsChanged',
] as const
export function robotsChangeSummary(
  details: string,
): { key: (typeof ROBOTS_CHANGE_FIELDS)[number]; value: string }[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(details)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  return ROBOTS_CHANGE_FIELDS.flatMap((key) => {
    const value: unknown = (parsed as Record<string, unknown>)[key]
    if (!Array.isArray(value) || !value.length) return []
    if (key === 'status')
      return value.length === 2
        ? [{ key, value: value.map((v) => (typeof v === 'number' ? String(v) : '?')).join(' → ') }]
        : []
    return [{ key, value: value.filter((v): v is string => typeof v === 'string').join(', ') }]
  })
}
