import { describe, expect, it } from 'vitest'
import { checkRelease, run, type ReleaseIO } from './cli'

const FILES = ['package.json', 'apps/web/package.json', 'packages/core/package.json']
const pkg = (version: string) =>
  `{\n  "name": "x",\n  "version": "${version}",\n  "private": true\n}\n`

const CHANGELOG = `# Changelog

## [Unreleased]

### Fixed

- A bug.

## [0.1.0] - 2026-10-01

### Added

- First release.
`

function fake(
  options: {
    version?: string
    changelog?: string | null
    tags?: string[]
    versions?: Record<string, string>
  } = {},
) {
  const files = new Map<string, string>()
  for (const path of FILES)
    files.set(path, pkg(options.versions?.[path] ?? options.version ?? '0.1.0'))
  if (options.changelog !== null) files.set('CHANGELOG.md', options.changelog ?? CHANGELOG)
  const out: string[] = []
  const err: string[] = []
  const io: ReleaseIO = {
    read: (path) => files.get(path) ?? null,
    write: (path, text) => void files.set(path, text),
    packageFiles: () => FILES,
    tags: () => options.tags ?? [],
    today: () => '2026-11-20',
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
  }
  return { io, files, out, err }
}

describe('check', () => {
  it('passes when the versions and the changelog agree', () => {
    expect(checkRelease(fake().io)).toEqual([])
  })

  it('finds a package that drifted', () => {
    const problems = checkRelease(fake({ versions: { 'apps/web/package.json': '0.1.1' } }).io)
    expect(problems).toEqual(['apps/web/package.json: version 0.1.1, but package.json says 0.1.0'])
  })

  it('finds a version bumped by hand', () => {
    const { io } = fake({ version: '0.2.0' })
    expect(checkRelease(io).join('\n')).toMatch(/newest release in CHANGELOG.md is 0.1.0/)
  })

  it('finds a release that is too small for what it changes', () => {
    const changelog = CHANGELOG.replace(
      '## [Unreleased]',
      '## [Unreleased]\n\n## [0.1.1] - 2026-10-15\n\n### Breaking\n\n- Renamed FOO.\n\n### Upgrade notes\n\n- Rename it.',
    )
    const problems = checkRelease(fake({ version: '0.1.1', changelog }).io).join('\n')
    expect(problems).toMatch(/0\.1\.1 is too small for its entries \(breaking\) after 0\.1\.0/)
    expect(problems).toMatch(/at least 0\.2\.0/)
  })

  it('asks for upgrade notes when something breaks', () => {
    const changelog = CHANGELOG.replace(
      '## [Unreleased]',
      '## [Unreleased]\n\n## [0.2.0] - 2026-10-15\n\n### Breaking\n\n- Renamed FOO.',
    )
    expect(checkRelease(fake({ version: '0.2.0', changelog }).io).join('\n')).toMatch(
      /add "### Upgrade notes"/,
    )
  })

  it('is fine with a first release of any version', () => {
    const changelog =
      '# Changelog\n\n## [Unreleased]\n\n## [3.0.0] - 2026-10-01\n\n### Added\n\n- x\n'
    expect(checkRelease(fake({ version: '3.0.0', changelog }).io)).toEqual([])
  })

  describe('with a tag', () => {
    const prepared = CHANGELOG.replace(
      '## [Unreleased]\n\n### Fixed\n\n- A bug.\n',
      '## [Unreleased]\n\n## [0.1.1] - 2026-11-20\n\n### Fixed\n\n- A bug.\n',
    )

    it('accepts the commit of the release', () => {
      expect(checkRelease(fake({ version: '0.1.1', changelog: prepared }).io, 'v0.1.1')).toEqual([])
    })

    it('refuses a tag that is not the version', () => {
      const { io } = fake({ version: '0.1.1', changelog: prepared })
      expect(checkRelease(io, 'v0.1.2').join('\n')).toMatch(/does not match the version/)
      expect(checkRelease(io, '0.1.1').join('\n')).toMatch(/not a version/)
    })

    it('refuses a commit that has entries the release does not include', () => {
      const changelog = prepared.replace(
        '## [Unreleased]\n',
        '## [Unreleased]\n\n### Added\n\n- Later.\n',
      )
      const problems = checkRelease(fake({ version: '0.1.1', changelog }).io, 'v0.1.1').join('\n')
      expect(problems).toMatch(/still has entries under \[Unreleased\]/)
    })

    it('refuses a version nobody prepared', () => {
      expect(checkRelease(fake().io, 'v0.1.0').join('\n')).toMatch(/still has entries under/)
    })
  })

  it('stops on a missing changelog or a version that is not one', async () => {
    const { io, err } = fake({ changelog: null })
    expect(await run(['check'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/CHANGELOG.md is missing/)
    expect(checkRelease(fake({ version: 'latest' }).io).join('\n')).toMatch(/is not a version/)
  })
})

describe('next', () => {
  it('names the version the entries ask for', async () => {
    const { io, out } = fake()
    expect(await run(['next'], io)).toBe(0)
    expect(out).toContain('impact: patch')
    expect(out).toContain('next version: 0.1.1 or later')
  })

  it('asks for a minor release for a breaking change while the major version is 0', async () => {
    const changelog = CHANGELOG.replace('### Fixed', '### Breaking')
    const { io, out } = fake({ changelog })
    await run(['next'], io)
    expect(out).toContain('next version: 0.2.0 or later')
  })

  it('says when there is nothing to release', async () => {
    const { io, out } = fake({ changelog: CHANGELOG.replace('### Fixed\n\n- A bug.\n', '') })
    await run(['next'], io)
    expect(out).toContain('impact: none')
    expect(out.join('\n')).toMatch(/nothing under \[Unreleased\]/)
  })
})

describe('prepare', () => {
  it('sets the version everywhere and closes the section', async () => {
    const { io, files, out } = fake()
    expect(await run(['prepare', '0.1.1'], io)).toBe(0)
    for (const path of FILES) expect(files.get(path)).toContain('"version": "0.1.1"')
    expect(files.get('package.json')).toBe(pkg('0.1.1'))
    expect(files.get('CHANGELOG.md')).toBe(`# Changelog

## [Unreleased]

## [0.1.1] - 2026-11-20

### Fixed

- A bug.

## [0.1.0] - 2026-10-01

### Added

- First release.
`)
    expect(out[0]).toBe('Prepared 0.1.1 (patch).')
    // And what it wrote is what check wants.
    expect(checkRelease(io)).toEqual([])
    expect(checkRelease(io, 'v0.1.1')).toEqual([])
  })

  it('does not allow a version smaller than the entries ask for', async () => {
    const changelog = CHANGELOG.replace('### Fixed', '### Added')
    const { io, files, err } = fake({ changelog })
    expect(await run(['prepare', '0.1.1'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/at least 0\.2\.0/)
    expect(files.get('package.json')).toBe(pkg('0.1.0'))
    expect(files.get('CHANGELOG.md')).toBe(changelog)
  })

  it('allows a bigger version than the entries ask for', async () => {
    const { io } = fake()
    expect(await run(['prepare', '1.0.0'], io)).toBe(0)
  })

  it('refuses a version that is not newer, or not a version', async () => {
    expect(await run(['prepare', '0.1.0'], fake().io)).toBe(1)
    expect(await run(['prepare', 'v0.2.0'], fake().io)).toBe(1)
    expect(await run(['prepare'], fake().io)).toBe(1)
  })

  it('refuses to release nothing', async () => {
    const { io, err } = fake({ changelog: CHANGELOG.replace('### Fixed\n\n- A bug.\n', '') })
    expect(await run(['prepare', '0.1.1'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/nothing to release/)
  })

  it('asks for upgrade notes before a breaking release', async () => {
    const { io, err } = fake({ changelog: CHANGELOG.replace('### Fixed', '### Breaking') })
    expect(await run(['prepare', '0.2.0'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/Upgrade notes/)
  })

  it('folds the candidates into the stable release', async () => {
    const { io, files } = fake({ changelog: CHANGELOG.replace('### Fixed', '### Added') })
    expect(await run(['prepare', '0.2.0-rc.1'], io)).toBe(0)
    // More work lands after the candidate…
    files.set(
      'CHANGELOG.md',
      files
        .get('CHANGELOG.md')!
        .replace(
          '## [Unreleased]\n',
          '## [Unreleased]\n\n### Fixed\n\n- A bug in the candidate.\n',
        ),
    )
    expect(await run(['prepare', '0.2.0'], io)).toBe(0)

    const text = files.get('CHANGELOG.md')!
    expect(text).not.toContain('0.2.0-rc.1')
    expect(text).toContain(
      '## [0.2.0] - 2026-11-20\n\n### Added\n\n- A bug.\n\n### Fixed\n\n- A bug in the candidate.\n',
    )
    expect(checkRelease(io, 'v0.2.0')).toEqual([])
  })

  it('counts a candidate from the last stable release, not from the previous candidate', async () => {
    const { io } = fake({ changelog: CHANGELOG.replace('### Fixed', '### Added') })
    expect(await run(['prepare', '0.2.0-rc.1'], io)).toBe(0)
    expect(checkRelease(io, 'v0.2.0-rc.1')).toEqual([])
  })
})

describe('notes', () => {
  it('prints the notes of a release with the image and how to update', async () => {
    const { io, out } = fake()
    expect(await run(['notes', '0.1.0'], io)).toBe(0)
    expect(out[0]).toContain('### Added\n\n- First release.')
    expect(out[0]).toContain('`ghcr.io/botaroikawa/seotools:0.1.0`')
    expect(out[0]).toContain('docs/updating.md')
  })

  it('says a candidate is not a stable release', async () => {
    const { io, out } = fake({ changelog: CHANGELOG.replace('### Fixed', '### Added') })
    await run(['prepare', '0.2.0-rc.1'], io)
    await run(['notes', '0.2.0-rc.1'], io)
    expect(out.at(-1)).toMatch(/release candidate/)
    expect(out.at(-1)).not.toMatch(/update guide/)
  })

  it('fails for a release that is not in the changelog', async () => {
    expect(await run(['notes', '9.9.9'], fake().io)).toBe(1)
  })
})

describe('plan', () => {
  const release = () => {
    const prepared = fake({ tags: ['v0.1.0', 'v0.1.1'] })
    return prepared
  }

  it('plans the publication of a tag as KEY=value lines', async () => {
    const { io, out } = release()
    await run(['prepare', '0.1.1'], io)
    out.length = 0
    expect(
      await run(
        ['plan', '--event', 'push', '--ref', 'refs/tags/v0.1.1', '--sha', 'abcdef0123'],
        io,
      ),
    ).toBe(0)
    expect(out).toEqual([
      'publish=true',
      'channel=release',
      'version=0.1.1',
      'prerelease=false',
      'latest=true',
      'exact_tags=0.1.1',
      'channel_tags=0.1 latest',
    ])
  })

  it('does not plan a tag whose release was never prepared', async () => {
    const { io, err } = release()
    expect(
      await run(
        ['plan', '--event', 'push', '--ref', 'refs/tags/v0.1.1', '--sha', 'abcdef0123'],
        io,
      ),
    ).toBe(1)
    expect(err.join('\n')).toMatch(/does not match the version/)
  })

  it('plans a development build for main', async () => {
    const { io, out } = release()
    await run(['plan', '--event', 'push', '--ref', 'refs/heads/main', '--sha', 'abcdef0123456'], io)
    expect(out).toContain('channel=development')
    expect(out).toContain('exact_tags=sha-abcdef0')
    expect(out).toContain('channel_tags=edge')
    expect(out).toContain('latest=false')
  })

  it('needs its arguments', async () => {
    expect(await run(['plan', '--ref', 'refs/heads/main'], fake().io)).toBe(1)
  })
})

describe('usage', () => {
  it('explains itself and fails for an unknown command', async () => {
    const { io, err } = fake()
    expect(await run(['publish'], io)).toBe(2)
    expect(err[0]).toMatch(/Usage:/)
    expect(await run([], io)).toBe(0)
  })
})
