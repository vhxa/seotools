import {
  compareVersions,
  maxImpact,
  parseVersion,
  type ParsedVersion,
  type ReleaseImpact,
} from '../version.ts'

/**
 * `CHANGELOG.md`: the one place where a change says what it does to the next release. Each entry
 * goes under the heading that names its impact, so the version a release needs can be read from
 * the file instead of argued about. Imported by `scripts/release.mjs`, which Node runs as it is.
 */

/** The headings of a section, in the order they are written, and what each one asks of the version. */
export const CHANGE_HEADINGS = ['Breaking', 'Added', 'Changed', 'Fixed', 'Security'] as const
export type ChangeHeading = (typeof CHANGE_HEADINGS)[number]

export const HEADING_IMPACT: Record<ChangeHeading, Exclude<ReleaseImpact, 'none'>> = {
  Breaking: 'breaking',
  Added: 'minor',
  Changed: 'minor',
  Fixed: 'patch',
  Security: 'patch',
}

/** What an administrator has to do to update: not a change, so it asks nothing of the version. */
export const UPGRADE_NOTES_HEADING = 'Upgrade notes'

export const UNRELEASED = 'Unreleased'

export interface ChangelogSection {
  /** `Unreleased`, or the version. */
  name: string
  version: ParsedVersion | null
  date: string | null
  /** The lines under each `###` heading, without blank lines at the edges. */
  blocks: Map<string, string[]>
  /** The section as written, from its heading to its last line. */
  raw: string
}

export interface Changelog {
  /** Everything before the first section. */
  preamble: string
  sections: ChangelogSection[]
  problems: string[]
}

const SECTION = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/
const SUBSECTION = /^### (.+?)\s*$/
const BULLET = /^[-*] \S/

function trimBlank(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]!.trim() === '') start++
  while (end > start && lines[end - 1]!.trim() === '') end--
  return lines.slice(start, end)
}

export function parseChangelog(text: string): Changelog {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const problems: string[] = []
  const starts = lines.flatMap((line, index) => (line.startsWith('## ') ? [index] : []))
  const preamble = lines.slice(0, starts[0] ?? lines.length).join('\n')

  const sections: ChangelogSection[] = []
  starts.forEach((start, i) => {
    const body = lines.slice(start, starts[i + 1] ?? lines.length)
    const heading = SECTION.exec(body[0]!)
    if (!heading) {
      problems.push(`CHANGELOG.md: "${body[0]}" is not a section like "## [1.2.3] - 2026-01-31"`)
      return
    }
    const name = heading[1]!
    const version = name === UNRELEASED ? null : parseVersion(name)
    if (name !== UNRELEASED && !version) {
      problems.push(`CHANGELOG.md: "${name}" is not a version`)
      return
    }

    const blocks = new Map<string, string[]>()
    let current: string[] | null = null
    for (const line of body.slice(1)) {
      const sub = SUBSECTION.exec(line)
      if (sub) {
        const title = sub[1]!
        if (![...CHANGE_HEADINGS, UPGRADE_NOTES_HEADING].includes(title as ChangeHeading)) {
          problems.push(
            `CHANGELOG.md [${name}]: unknown heading "### ${title}" ` +
              `(use ${[...CHANGE_HEADINGS, UPGRADE_NOTES_HEADING].join(', ')})`,
          )
        }
        if (blocks.has(title)) problems.push(`CHANGELOG.md [${name}]: "### ${title}" appears twice`)
        current = blocks.get(title) ?? []
        blocks.set(title, current)
      } else {
        current?.push(line)
      }
    }
    for (const [title, block] of blocks) blocks.set(title, trimBlank(block))

    sections.push({
      name,
      version,
      date: heading[2] ?? null,
      blocks,
      raw: trimBlank(body).join('\n'),
    })
  })

  const releases = sections.filter((section) => section.version)
  if (sections[0]?.name !== UNRELEASED) {
    problems.push('CHANGELOG.md: the first section must be "## [Unreleased]"')
  }
  if (sections.filter((section) => section.name === UNRELEASED).length > 1) {
    problems.push('CHANGELOG.md: "## [Unreleased]" appears twice')
  }
  releases.forEach((section, i) => {
    if (!section.date) problems.push(`CHANGELOG.md [${section.name}]: the release has no date`)
    if (entryCount(section) === 0) problems.push(`CHANGELOG.md [${section.name}]: no entries`)
    const older = releases[i + 1]
    if (older && compareVersions(section.version!, older.version!) <= 0) {
      problems.push(
        `CHANGELOG.md: ${section.name} must come before ${older.name} (newest release first)`,
      )
    }
  })

  return { preamble, sections, problems }
}

type Blocks = ReadonlyMap<string, readonly string[]>

/** How many entries there are under one heading, or under all the change headings. */
export function entryCount(source: ChangelogSection | Blocks, heading?: string): number {
  const blocks = 'blocks' in source ? source.blocks : source
  const headings = heading ? [heading] : CHANGE_HEADINGS
  return headings.reduce(
    (sum, title) => sum + (blocks.get(title) ?? []).filter((line) => BULLET.test(line)).length,
    0,
  )
}

/** The biggest impact among the entries; `none` when there are none. */
export function entriesImpact(source: ChangelogSection | Blocks): ReleaseImpact {
  return maxImpact(
    CHANGE_HEADINGS.filter((heading) => entryCount(source, heading) > 0).map(
      (heading) => HEADING_IMPACT[heading],
    ),
  )
}

/** The entries of several sections as one, heading by heading, in the order given. */
export function mergeBlocks(sections: readonly ChangelogSection[]): Map<string, string[]> {
  const merged = new Map<string, string[]>()
  for (const section of sections) {
    for (const [title, lines] of section.blocks) {
      if (lines.length === 0) continue
      merged.set(title, [...(merged.get(title) ?? []), ...lines])
    }
  }
  return merged
}

/** A section written the way the file keeps them: the change headings, then the upgrade notes. */
export function renderSection(name: string, date: string | null, blocks: Blocks): string {
  const out = [`## [${name}]${date ? ` - ${date}` : ''}`]
  for (const title of [...CHANGE_HEADINGS, UPGRADE_NOTES_HEADING]) {
    const lines = blocks.get(title)
    if (lines && lines.length > 0) out.push('', `### ${title}`, '', ...lines)
  }
  return out.join('\n')
}

/** What a release says, for the notes published with it: the section without its heading. */
export function sectionBody(section: ChangelogSection): string {
  return section.raw.split('\n').slice(1).join('\n').trim()
}
