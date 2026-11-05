import { describe, expect, it } from 'vitest'
import {
  entriesImpact,
  entryCount,
  mergeBlocks,
  parseChangelog,
  renderSection,
  sectionBody,
} from './changelog'

const sample = `# Changelog

Notes before the first section.

## [Unreleased]

### Added

- A thing.

### Fixed

- A bug.
  More about the bug.

## [0.2.0] - 2026-11-01

### Breaking

- The variable \`FOO\` is now \`BAR\`.

### Upgrade notes

- Rename it in your \`.env\`.

## [0.1.0] - 2026-10-01

### Added

- First release.
`

describe('parseChangelog', () => {
  const changelog = parseChangelog(sample)

  it('reads the sections, newest first', () => {
    expect(changelog.problems).toEqual([])
    expect(changelog.sections.map((section) => section.name)).toEqual([
      'Unreleased',
      '0.2.0',
      '0.1.0',
    ])
    expect(changelog.preamble).toContain('Notes before the first section.')
    expect(changelog.sections[1]).toMatchObject({ date: '2026-11-01' })
  })

  it('counts entries, not lines', () => {
    const [unreleased] = changelog.sections
    expect(entryCount(unreleased!, 'Fixed')).toBe(1)
    expect(entryCount(unreleased!)).toBe(2)
  })

  it('takes the impact from the headings', () => {
    const [unreleased, breaking, first] = changelog.sections
    expect(entriesImpact(unreleased!)).toBe('minor')
    expect(entriesImpact(breaking!)).toBe('breaking')
    expect(entriesImpact(first!)).toBe('minor')
    expect(
      entriesImpact(parseChangelog('## [Unreleased]\n\n### Fixed\n\n- x\n').sections[0]!),
    ).toBe('patch')
    expect(entriesImpact(parseChangelog('## [Unreleased]\n').sections[0]!)).toBe('none')
  })

  it('gives the notes of a release without its heading', () => {
    expect(sectionBody(changelog.sections[2]!)).toBe('### Added\n\n- First release.')
  })

  it.each([
    ['no Unreleased first', '## [0.1.0] - 2026-10-01\n\n### Added\n\n- x\n', /first section/],
    ['a typo in a heading', '## [Unreleased]\n\n### Fix\n\n- x\n', /unknown heading "### Fix"/],
    ['a release without a date', '## [Unreleased]\n\n## [0.1.0]\n\n### Added\n\n- x\n', /no date/],
    ['a release without entries', '## [Unreleased]\n\n## [0.1.0] - 2026-10-01\n', /no entries/],
    [
      'releases out of order',
      '## [Unreleased]\n\n## [0.1.0] - 2026-10-01\n\n### Added\n\n- x\n\n## [0.2.0] - 2026-11-01\n\n### Added\n\n- y\n',
      /must come before/,
    ],
    [
      'a name that is not a version',
      '## [Unreleased]\n\n## [next] - 2026-10-01\n',
      /not a version/,
    ],
    ['a heading that is not a section', '## [Unreleased]\n\n## Later\n', /is not a section/],
  ])('reports %s', (_name, text, expected) => {
    expect(parseChangelog(text).problems.join('\n')).toMatch(expected)
  })
})

describe('writing sections', () => {
  it('merges the blocks of several sections heading by heading', () => {
    const a = parseChangelog('## [Unreleased]\n\n### Added\n\n- a\n\n### Fixed\n\n- f\n')
      .sections[0]!
    const b = parseChangelog('## [Unreleased]\n\n### Added\n\n- b\n').sections[0]!
    const merged = mergeBlocks([a, b])
    expect(merged.get('Added')).toEqual(['- a', '- b'])
    expect(merged.get('Fixed')).toEqual(['- f'])
  })

  it('renders headings in the canonical order and leaves out the empty ones', () => {
    const blocks = new Map([
      ['Fixed', ['- f']],
      ['Upgrade notes', ['- n']],
      ['Breaking', ['- b']],
      ['Added', []],
    ])
    expect(renderSection('0.3.0', '2026-12-01', blocks)).toBe(
      '## [0.3.0] - 2026-12-01\n\n### Breaking\n\n- b\n\n### Fixed\n\n- f\n\n### Upgrade notes\n\n- n',
    )
    expect(renderSection('Unreleased', null, new Map())).toBe('## [Unreleased]')
  })
})
