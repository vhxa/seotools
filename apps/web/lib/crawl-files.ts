import {
  crawlFileState,
  isDefaultSitemapUrl,
  isInternalUrl,
  markdownHeadings,
  normalizeCrawlUrl,
  parseLlms,
  parseRobots,
  parseSecurityTxt,
  robotsAccess,
  type CrawlFileState,
  type ParsedLlms,
  type ParsedRobots,
  type ParsedSecurityTxt,
} from '@seotools/core'
import type { CrawlFile, CrawlFileCheck } from '@seotools/db'

/** Past this long, a requested refresh is taken for lost: the worker retries it on its own. */
const CHECK_PENDING_MS = 15 * 60_000
/** Google stops reading a robots.txt here, so what comes after does not exist for it. */
export const ROBOTS_LIMIT_BYTES = 500 * 1024

/** Whether fresher data is on its way: it was asked for, or the domain was never checked. */
export function isCheckPending(check: CrawlFileCheck | null, now: Date): boolean {
  if (!check) return true
  return (
    check.requestedAt !== null && now.getTime() - check.requestedAt.getTime() < CHECK_PENDING_MS
  )
}

const stateOf = (file: CrawlFile) => crawlFileState(file)

/** The copy of a file that speaks for the site: the first one that is really there. */
export function primaryFile(files: CrawlFile[]): CrawlFile | null {
  return (
    files
      .filter((file) => stateOf(file) === 'ok')
      // Over HTTPS if possible, as that is where the site most likely lives.
      .sort((a, b) => Number(b.url.startsWith('https:')) - Number(a.url.startsWith('https:')))[0] ??
    null
  )
}

/** When any of the files was last requested. */
export function lastFetched(files: CrawlFile[]): CrawlFile | null {
  return files.reduce<CrawlFile | null>(
    (newest, file) => (!newest || file.fetchedAt > newest.fetchedAt ? file : newest),
    null,
  )
}

export type RobotsFinding =
  | 'missing'
  | 'unavailable'
  | 'invalid'
  | 'site-blocked'
  | 'too-large'
  | 'no-sitemaps'
  | 'origins-differ'
  | 'syntax-issues'

export interface RobotsView {
  file: CrawlFile | null
  parsed: ParsedRobots | null
  findings: RobotsFinding[]
  /** Nothing can be said about what bots may do, since the file could not be read. */
  unknown: boolean
}

export function robotsView(files: CrawlFile[]): RobotsView {
  const file = primaryFile(files)
  const states = files.map(stateOf)
  if (!file || file.body === null) {
    // A 5xx is the worst of these: search engines take it to mean the whole site is off limits.
    const unavailable = states.some((state) => state === 'server-error' || state === 'unreachable')
    const invalid = states.includes('invalid')
    return {
      file: null,
      parsed: null,
      findings:
        files.length === 0 ? [] : [unavailable ? 'unavailable' : invalid ? 'invalid' : 'missing'],
      unknown: unavailable || invalid,
    }
  }

  const parsed = parseRobots(file.body)
  const findings: RobotsFinding[] = []
  if (robotsAccess(parsed, '*').access === 'blocked') findings.push('site-blocked')
  if (file.truncated || (file.bytes ?? 0) > ROBOTS_LIMIT_BYTES) findings.push('too-large')
  if (parsed.sitemaps.length === 0) findings.push('no-sitemaps')
  const copies = files.filter((other) => stateOf(other) === 'ok')
  if (new Set(copies.map((copy) => copy.body)).size > 1) findings.push('origins-differ')
  if (parsed.issues.length > 0) findings.push('syntax-issues')
  return { file, parsed, findings, unknown: false }
}

export type SitemapOrigin = 'robots' | 'default' | 'other'

export interface SitemapRow {
  url: string
  origin: SitemapOrigin
  file: CrawlFile | null
  /** `null` when it is declared but was not requested. */
  state: CrawlFileState | null
  /** On another site, which is why it was not requested. */
  external: boolean
}

export type SitemapFinding = 'none' | 'not-declared' | 'declared-broken' | 'empty'

export interface SitemapsView {
  rows: SitemapRow[]
  /** Usual locations that were tried, and held nothing. Normal, so they are not rows. */
  triedCount: number
  fileCount: number
  urlCount: number
  lastModified: string | null
  findings: SitemapFinding[]
}

/** The URLs the robots.txt files declare as sitemaps, normalized like the rows they refer to. */
function declaredSitemaps(robots: CrawlFile[]): Set<string> {
  const declared = new Set<string>()
  for (const file of robots) {
    if (stateOf(file) !== 'ok' || file.body === null) continue
    for (const raw of parseRobots(file.body).sitemaps) {
      const url = normalizeCrawlUrl(raw, file.url)
      if (url) declared.add(url)
    }
  }
  return declared
}

export function sitemapsView(
  sitemaps: CrawlFile[],
  robots: CrawlFile[],
  host: string,
): SitemapsView {
  const declared = declaredSitemaps(robots)
  const rows: SitemapRow[] = []
  let triedCount = 0
  for (const file of sitemaps) {
    const state = stateOf(file)
    const isDeclared = declared.has(file.url)
    const isDefault = isDefaultSitemapUrl(file.url)
    if (!isDeclared && isDefault && state !== 'ok') {
      triedCount++
      continue
    }
    rows.push({
      url: file.url,
      origin: isDeclared ? 'robots' : isDefault ? 'default' : 'other',
      file,
      state,
      external: false,
    })
  }
  const known = new Set(sitemaps.map((file) => file.url))
  for (const url of declared) {
    if (!known.has(url)) {
      rows.push({
        url,
        origin: 'robots',
        file: null,
        state: null,
        external: !isInternalUrl(url, host),
      })
    }
  }

  const found = rows.filter((row) => row.state === 'ok')
  // An index only points to other sitemaps: counting it too would count those twice.
  const lists = found.filter((row) => row.file?.data?.sitemap?.format !== 'index')
  const urlCount = lists.reduce((sum, row) => sum + (row.file?.data?.sitemap?.entries ?? 0), 0)
  const lastModified = found
    .map((row) => row.file?.data?.sitemap?.lastModified ?? null)
    .reduce<string | null>(
      (newest, date) => (date && (!newest || date > newest) ? date : newest),
      null,
    )

  const findings: SitemapFinding[] = []
  if (found.length === 0) findings.push('none')
  else {
    if (!rows.some((row) => row.origin === 'robots')) findings.push('not-declared')
    if (lists.length > 0 && urlCount === 0) findings.push('empty')
  }
  if (
    rows.some(
      (row) =>
        row.origin === 'robots' && row.state !== 'ok' && !row.external && row.state !== 'redirect',
    )
  ) {
    findings.push('declared-broken')
  }
  return { rows, triedCount, fileCount: found.length, urlCount, lastModified, findings }
}

export type LlmsFinding =
  'missing' | 'unavailable' | 'invalid' | 'no-title' | 'no-summary' | 'no-links'

export interface LlmsView {
  file: CrawlFile | null
  parsed: ParsedLlms | null
  findings: LlmsFinding[]
}

export function llmsView(files: CrawlFile[]): LlmsView {
  const file = primaryFile(files)
  if (!file || file.body === null) {
    const states = files.map(stateOf)
    const finding: LlmsFinding = states.includes('invalid')
      ? 'invalid'
      : states.some((state) => state === 'server-error' || state === 'unreachable')
        ? 'unavailable'
        : 'missing'
    return { file: null, parsed: null, findings: files.length === 0 ? [] : [finding] }
  }
  const parsed = parseLlms(file.body)
  const findings: LlmsFinding[] = []
  if (!parsed.title) findings.push('no-title')
  if (!parsed.summary) findings.push('no-summary')
  if (parsed.linkCount === 0) findings.push('no-links')
  return { file, parsed, findings }
}

export function llmsFullView(files: CrawlFile[]) {
  const file = primaryFile(files)
  if (!file || file.body === null) return null
  const headings = markdownHeadings(file.body)
  return {
    file,
    title: headings.find((heading) => heading.level === 1)?.title ?? null,
    headingCount: headings.length,
  }
}

export type SecurityFinding = 'no-contact' | 'no-expiry' | 'expired' | 'wrong-location'

export function securityView(
  file: CrawlFile,
  now: Date,
): { parsed: ParsedSecurityTxt; findings: SecurityFinding[] } {
  const parsed = parseSecurityTxt(file.body ?? '')
  const findings: SecurityFinding[] = []
  if (parsed.contacts.length === 0) findings.push('no-contact')
  if (!parsed.expires) findings.push('no-expiry')
  else if (parsed.expires < now) findings.push('expired')
  if (!new URL(file.url).pathname.startsWith('/.well-known/')) findings.push('wrong-location')
  return { parsed, findings }
}

/** The key of the IndexNow file has to be what the file holds, or search engines will refuse it. */
export const indexNowKeyMatches = (file: CrawlFile, key: string) => file.body?.trim() === key

/** Files found at guessed locations only matter if they are there. */
export const presentFiles = (files: CrawlFile[]) => files.filter((file) => stateOf(file) === 'ok')
