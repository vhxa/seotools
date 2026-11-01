import { describe, expect, it } from 'vitest'
import { isRobotsAllowed, matchesRobotsPattern, parseRobots, robotsAccess } from './robots'

describe('parseRobots', () => {
  it('groups consecutive user agents and their rules', () => {
    const { groups, sitemaps, issues } = parseRobots(
      [
        'User-agent: a',
        'USER-AGENT: b # comment',
        'Disallow: /private',
        'Allow: /private/ok',
        'Crawl-delay: 2.5',
        '',
        'User-agent: c',
        'Disallow:',
        'Sitemap: https://example.com/s.xml',
      ].join('\r\n'),
    )
    expect(groups).toEqual([
      {
        userAgents: ['a', 'b'],
        rules: [
          { type: 'disallow', path: '/private' },
          { type: 'allow', path: '/private/ok' },
        ],
        crawlDelay: 2.5,
      },
      { userAgents: ['c'], rules: [{ type: 'disallow', path: '' }], crawlDelay: null },
    ])
    expect(sitemaps).toEqual(['https://example.com/s.xml'])
    expect(issues).toEqual([])
  })

  it('starts a new group when a user agent follows rules, with no blank line needed', () => {
    const { groups } = parseRobots('User-agent: a\nDisallow: /x\nUser-agent: b\nDisallow: /y')
    expect(groups.map((group) => group.userAgents)).toEqual([['a'], ['b']])
  })

  it('ignores a byte order mark', () => {
    expect(parseRobots('\ufeffUser-agent: *').groups[0]?.userAgents).toEqual(['*'])
  })

  it('reports what is wrong, with its line', () => {
    const { issues } = parseRobots(
      [
        'Disallow: /orphan',
        'not a directive',
        'User-agent: *',
        'Noindex: /x',
        'Disalow: /typo',
        'Crawl-delay: soon',
        'Sitemap:',
        'Host: example.com',
        'Content-Signal: ai-train=no',
      ].join('\n'),
    )
    expect(issues.map(({ line, type }) => [line, type])).toEqual([
      [1, 'rule-outside-group'],
      [2, 'invalid-line'],
      [4, 'unsupported-directive'],
      [5, 'unknown-directive'],
      [6, 'invalid-line'],
      [7, 'invalid-line'],
    ])
  })
})

describe('matchesRobotsPattern', () => {
  it.each([
    ['/fish', '/fish', true],
    ['/fish', '/fish.html', true],
    ['/fish', '/Fish', false],
    ['/fish/', '/fish', false],
    ['/*.php', '/index.php', true],
    ['/*.php', '/a/b.php?x=1', true],
    ['/*.php$', '/a/b.php', true],
    ['/*.php$', '/a/b.php?x=1', false],
    ['/fish*', '/fish', true],
    ['/', '/anything', true],
    ['/a$', '/a', true],
    ['/a$', '/ab', false],
    ['/a*b*c', '/axxbyyc', true],
    ['/a*b*c', '/axxbyy', false],
  ])('%s against %s is %s', (pattern, path, expected) => {
    expect(matchesRobotsPattern(pattern, path)).toBe(expected)
  })

  it('does not blow up on a pattern made to backtrack', () => {
    const started = Date.now()
    expect(matchesRobotsPattern(`/${'*a'.repeat(5000)}b`, `/${'a'.repeat(5000)}`)).toBe(false)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

describe('isRobotsAllowed', () => {
  const robots = parseRobots(
    [
      'User-agent: *',
      'Disallow: /private',
      'Allow: /private/public',
      '',
      'User-agent: GoodBot',
      'Disallow:',
      '',
      'User-agent: Tie',
      'Disallow: /a',
      'Allow: /a',
    ].join('\n'),
  )

  it('applies the longest match', () => {
    expect(isRobotsAllowed(robots, 'Other', '/private/x')).toBe(false)
    expect(isRobotsAllowed(robots, 'Other', '/private/public/x')).toBe(true)
    expect(isRobotsAllowed(robots, 'Other', '/open')).toBe(true)
  })

  it('prefers the group naming the user agent, whatever its case, over `*`', () => {
    expect(isRobotsAllowed(robots, 'goodbot', '/private/x')).toBe(true)
  })

  it('lets `allow` win a tie', () => {
    expect(isRobotsAllowed(robots, 'Tie', '/a')).toBe(true)
  })

  it('allows everything when no group applies', () => {
    expect(isRobotsAllowed(parseRobots('User-agent: a\nDisallow: /'), 'b', '/x')).toBe(true)
  })

  it('merges the groups that name the same user agent', () => {
    const merged = parseRobots('User-agent: a\nDisallow: /x\n\nUser-agent: a\nDisallow: /y')
    expect(isRobotsAllowed(merged, 'a', '/x')).toBe(false)
    expect(isRobotsAllowed(merged, 'a', '/y')).toBe(false)
  })
})

describe('robotsAccess', () => {
  it.each([
    ['User-agent: GPTBot\nDisallow: /', 'blocked', 'specific'],
    ['User-agent: GPTBot\nDisallow: /*', 'blocked', 'specific'],
    ['User-agent: gptbot\nDisallow:', 'allowed', 'specific'],
    ['User-agent: GPTBot\nDisallow: /private', 'partial', 'specific'],
    ['User-agent: GPTBot\nDisallow: /\nAllow: /blog', 'partial', 'specific'],
    ['User-agent: *\nDisallow: /', 'blocked', 'wildcard'],
    ['User-agent: *\nAllow: /', 'allowed', 'wildcard'],
    ['User-agent: other\nDisallow: /', 'allowed', 'none'],
    ['', 'allowed', 'none'],
  ])('%j', (text, access, matchedBy) => {
    expect(robotsAccess(parseRobots(text), 'GPTBot')).toMatchObject({ access, matchedBy })
  })

  it('lets a group naming the bot override a blocking `*`', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /')
    expect(robotsAccess(robots, 'GPTBot').access).toBe('allowed')
    expect(robotsAccess(robots, '*').access).toBe('blocked')
  })
})
