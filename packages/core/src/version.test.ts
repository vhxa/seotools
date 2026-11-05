import { describe, expect, it } from 'vitest'
import {
  buildKind,
  compareVersionStrings,
  compatibilityLine,
  crossesCompatibilityLine,
  formatVersion,
  maxImpact,
  meetsImpact,
  minimumVersionFor,
  parseTag,
  parseVersion,
  versionChange,
  type ParsedVersion,
} from './version'

const v = (input: string): ParsedVersion => {
  const parsed = parseVersion(input)
  if (!parsed) throw new Error(`not a version: ${input}`)
  return parsed
}

describe('parseVersion', () => {
  it('reads stable versions and candidates', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseVersion('0.2.0-rc.1')).toEqual({
      major: 0,
      minor: 2,
      patch: 0,
      prerelease: ['rc', '1'],
    })
    expect(formatVersion(v('10.20.30-beta.2'))).toBe('10.20.30-beta.2')
  })

  it.each([
    '',
    '1',
    '1.2',
    '1.2.3.4',
    'v1.2.3',
    '01.2.3',
    '1.02.3',
    '1.2.3-',
    '1.2.3-rc..1',
    '1.2.3-rc.01',
    '1.2.3+build',
    '1.2.3-rc+build',
    ' 1.2.3',
    '1.2.x',
    '-1.2.3',
    '1234567890.0.0',
    `1.2.3-${'a'.repeat(80)}`,
  ])('refuses %j', (input) => {
    expect(parseVersion(input)).toBeNull()
  })

  it('reads a tag only with its v', () => {
    expect(parseTag('v0.2.0-rc.1')).toEqual(v('0.2.0-rc.1'))
    expect(parseTag('0.2.0')).toBeNull()
    expect(parseTag('release-1.2.3')).toBeNull()
  })

  it('stays linear on hostile input', () => {
    const started = performance.now()
    parseVersion(`1.2.3-${'1'.repeat(60)}`)
    parseVersion('9'.repeat(64))
    expect(performance.now() - started).toBeLessThan(50)
  })
})

describe('compareVersionStrings', () => {
  it('follows Semantic Versioning precedence', () => {
    // The list of the semver.org specification, oldest first.
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '2.0.0',
    ]
    for (let i = 0; i < ordered.length; i++) {
      for (let j = 0; j < ordered.length; j++) {
        const expected = Math.sign(i - j)
        expect(
          compareVersionStrings(ordered[i]!, ordered[j]!),
          `${ordered[i]} ? ${ordered[j]}`,
        ).toBe(expected)
      }
    }
  })

  it('compares numbers as numbers, not as text', () => {
    expect(compareVersionStrings('0.10.0', '0.9.0')).toBe(1)
    expect(compareVersionStrings('1.0.0-rc.10', '1.0.0-rc.9')).toBe(1)
  })

  it('is null when either side is not a version', () => {
    expect(compareVersionStrings('unknown', '1.0.0')).toBeNull()
    expect(compareVersionStrings('1.0.0', 'v1.0.0')).toBeNull()
  })
})

describe('compatibility', () => {
  it('puts minors apart while the major version is 0, and majors apart after', () => {
    expect(compatibilityLine(v('0.2.5'))).toBe('0.2')
    expect(compatibilityLine(v('1.4.0'))).toBe('1')
    expect(crossesCompatibilityLine(v('0.2.0'), v('0.2.9'))).toBe(false)
    expect(crossesCompatibilityLine(v('0.2.9'), v('0.3.0'))).toBe(true)
    expect(crossesCompatibilityLine(v('1.0.0'), v('1.9.0'))).toBe(false)
    expect(crossesCompatibilityLine(v('1.9.0'), v('2.0.0'))).toBe(true)
    expect(crossesCompatibilityLine(v('0.9.0'), v('1.0.0'))).toBe(true)
  })

  it('names the biggest part that changed', () => {
    expect(versionChange(v('1.2.3'), v('2.0.0'))).toBe('major')
    expect(versionChange(v('1.2.3'), v('1.3.0'))).toBe('minor')
    expect(versionChange(v('1.2.3'), v('1.2.4'))).toBe('patch')
    expect(versionChange(v('1.2.3-rc.1'), v('1.2.3'))).toBe('prerelease')
  })
})

describe('buildKind', () => {
  const build = (version: string, channel: 'release' | 'development' = 'release') => ({
    version,
    channel,
    commit: null,
  })

  it('tells a release, a candidate and a development build apart', () => {
    expect(buildKind(build('0.2.0'))).toBe('release')
    expect(buildKind(build('0.2.0-rc.1'))).toBe('candidate')
    expect(buildKind(build('0.2.0', 'development'))).toBe('development')
  })

  it('never takes a version nobody could have published for a release', () => {
    expect(buildKind(build('unknown'))).toBe('development')
    expect(buildKind(build(''))).toBe('development')
  })
})

describe('release impact', () => {
  it('takes the highest impact', () => {
    expect(maxImpact([])).toBe('none')
    expect(maxImpact(['patch', 'none'])).toBe('patch')
    expect(maxImpact(['patch', 'breaking', 'minor'])).toBe('breaking')
  })

  it('asks for a minor release for a breaking change while the major version is 0', () => {
    expect(formatVersion(minimumVersionFor(v('0.2.3'), 'breaking'))).toBe('0.3.0')
    expect(formatVersion(minimumVersionFor(v('0.2.3'), 'minor'))).toBe('0.3.0')
    expect(formatVersion(minimumVersionFor(v('0.2.3'), 'patch'))).toBe('0.2.4')
  })

  it('asks for a major release for a breaking change from 1.0.0', () => {
    expect(formatVersion(minimumVersionFor(v('1.4.2'), 'breaking'))).toBe('2.0.0')
    expect(formatVersion(minimumVersionFor(v('1.4.2'), 'minor'))).toBe('1.5.0')
    expect(formatVersion(minimumVersionFor(v('1.4.2'), 'patch'))).toBe('1.4.3')
  })

  it('accepts a bigger version, and a candidate of the version it asks for', () => {
    expect(meetsImpact(v('0.2.0'), v('0.3.0'), 'breaking')).toBe(true)
    expect(meetsImpact(v('0.2.0'), v('0.3.0-rc.1'), 'breaking')).toBe(true)
    expect(meetsImpact(v('0.2.0'), v('1.0.0'), 'breaking')).toBe(true)
    expect(meetsImpact(v('0.2.0'), v('0.2.1'), 'breaking')).toBe(false)
    expect(meetsImpact(v('0.2.0'), v('0.2.1'), 'minor')).toBe(false)
    expect(meetsImpact(v('1.2.0'), v('1.3.0'), 'breaking')).toBe(false)
    expect(meetsImpact(v('1.2.0'), v('1.2.1'), 'patch')).toBe(true)
  })
})
