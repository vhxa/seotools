/** Parsers for the plain-text files sites publish. They run on untrusted input, so no backtracking. */

export interface LlmsLink {
  title: string
  url: string
  notes: string | null
}

export interface LlmsSection {
  /** `null` for links before the first `##` heading. */
  title: string | null
  links: LlmsLink[]
}

export interface ParsedLlms {
  title: string | null
  /** The blockquote under the title. */
  summary: string | null
  sections: LlmsSection[]
  linkCount: number
}

const LLMS_LINK = /^\s*[-*+]\s*\[([^\]]+)\]\(([^)\s]+)\)\s*(?::\s*(.*))?$/

/** Reads an llms.txt as llmstxt.org lays it out: H1, blockquote, then H2 sections of link lists. */
export function parseLlms(text: string): ParsedLlms {
  const parsed: ParsedLlms = { title: null, summary: null, sections: [], linkCount: 0 }
  const quote: string[] = []
  let inQuote = true
  let fenced = false

  for (const line of text.replace(/^\ufeff/, '').split(/\r\n|\r|\n/)) {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    if (parsed.title === null && line.startsWith('# ')) {
      parsed.title = line.slice(2).trim()
      continue
    }
    if (line.startsWith('## ')) {
      parsed.sections.push({ title: line.slice(3).trim(), links: [] })
      inQuote = false
      continue
    }
    if (line.startsWith('>')) {
      if (inQuote) quote.push(line.slice(1).trim())
      continue
    }
    // The summary is the first blockquote: whatever text comes after it has ended it.
    if (line.trim() && quote.length > 0) inQuote = false

    const link = LLMS_LINK.exec(line)
    if (link?.[1] && link[2]) {
      let section = parsed.sections.at(-1)
      if (!section) {
        section = { title: null, links: [] }
        parsed.sections.push(section)
      }
      section.links.push({ title: link[1], url: link[2], notes: link[3]?.trim() || null })
      parsed.linkCount++
    }
  }
  if (quote.length > 0) parsed.summary = quote.join(' ').trim() || null
  return parsed
}

/** The headings of a Markdown document, for a sense of what an llms-full.txt covers. */
export function markdownHeadings(text: string): { level: number; title: string }[] {
  const headings: { level: number; title: string }[] = []
  let fenced = false
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced
      continue
    }
    if (fenced || !line.startsWith('#')) continue
    const level = line.length - line.replace(/^#+/, '').length
    if (level <= 6 && line[level] === ' ') {
      headings.push({ level, title: line.slice(level + 1).trim() })
    }
  }
  return headings
}

export interface ParsedAdsTxt {
  /** `domain, publisher id, DIRECT|RESELLER[, certification id]` lines. */
  records: number
  direct: number
  reseller: number
  /** Distinct advertising systems. */
  systems: number
  /** `CONTACT=`, `SUBDOMAIN=`… */
  variables: { name: string; value: string }[]
  /** 1-based lines that are neither a record nor a variable. */
  invalidLines: number[]
}

/** Reads an ads.txt or app-ads.txt, as the IAB defines them. */
export function parseAdsTxt(text: string): ParsedAdsTxt {
  const parsed: ParsedAdsTxt = {
    records: 0,
    direct: 0,
    reseller: 0,
    systems: 0,
    variables: [],
    invalidLines: [],
  }
  const systems = new Set<string>()
  text
    .replace(/^\ufeff/, '')
    .split(/\r\n|\r|\n/)
    .forEach((raw, index) => {
      const line = (raw.split('#')[0] ?? '').trim()
      if (!line) return
      const fields = line.split(',').map((field) => field.trim())
      const relationship = fields[2]?.toUpperCase()
      if (
        fields.length >= 3 &&
        fields[0] &&
        fields[1] &&
        (relationship === 'DIRECT' || relationship === 'RESELLER')
      ) {
        parsed.records++
        if (relationship === 'DIRECT') parsed.direct++
        else parsed.reseller++
        systems.add(fields[0].toLowerCase())
        return
      }
      const equals = line.indexOf('=')
      if (equals > 0 && !line.includes(',')) {
        parsed.variables.push({
          name: line.slice(0, equals).trim(),
          value: line.slice(equals + 1).trim(),
        })
        return
      }
      parsed.invalidLines.push(index + 1)
    })
  parsed.systems = systems.size
  return parsed
}

export interface ParsedSecurityTxt {
  fields: { name: string; value: string }[]
  contacts: string[]
  /** `null` when missing or unreadable. */
  expires: Date | null
}

/** Reads a security.txt (RFC 9116). `Contact` and `Expires` are the fields it requires. */
export function parseSecurityTxt(text: string): ParsedSecurityTxt {
  const parsed: ParsedSecurityTxt = { fields: [], contacts: [], expires: null }
  for (const raw of text.replace(/^\ufeff/, '').split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    // A signed file ends with its signature: what follows is not fields.
    if (line.startsWith('-----BEGIN PGP SIGNATURE')) break
    if (line.startsWith('-----') || /^hash:/i.test(line)) continue
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const name = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    parsed.fields.push({ name, value })
    if (name.toLowerCase() === 'contact') parsed.contacts.push(value)
    if (name.toLowerCase() === 'expires') {
      const date = new Date(value)
      parsed.expires = Number.isNaN(date.getTime()) ? null : date
    }
  }
  return parsed
}
