export interface RobotsRule {
  type: 'allow' | 'disallow'
  path: string
}

export interface RobotsGroup {
  userAgents: string[]
  rules: RobotsRule[]
  crawlDelay: number | null
}

export interface RobotsIssue {
  /** 1-based. */
  line: number
  /**
   * - `invalid-line`: not a `name: value` pair.
   * - `rule-outside-group`: a rule with no `User-agent` before it, which nobody will obey.
   * - `unsupported-directive`: looks like it does something, but search engines ignore it.
   * - `unknown-directive`: not a directive of any robots.txt dialect we know of.
   */
  type: 'invalid-line' | 'rule-outside-group' | 'unsupported-directive' | 'unknown-directive'
  text: string
}

export interface ParsedRobots {
  groups: RobotsGroup[]
  sitemaps: string[]
  issues: RobotsIssue[]
}

/** Directives of other dialects: not part of RFC 9309, but valid where they are meant to be read. */
const EXTENSIONS = new Set([
  'clean-param',
  'content-signal',
  'content-usage',
  'host',
  'request-rate',
  'visit-time',
])
/** Page directives that were never part of robots.txt. Google stopped reading them in 2019. */
const UNSUPPORTED = new Set(['noarchive', 'nofollow', 'noindex'])

/** Reads a robots.txt the way RFC 9309 describes, keeping what is wrong with it. */
export function parseRobots(text: string): ParsedRobots {
  const parsed: ParsedRobots = { groups: [], sitemaps: [], issues: [] }
  let group: RobotsGroup | null = null
  let readingAgents = false

  const lines = text.replace(/^\ufeff/, '').split(/\r\n|\r|\n/)
  lines.forEach((raw, index) => {
    const line = (raw.split('#')[0] ?? '').trim()
    if (!line) return
    const issue = (type: RobotsIssue['type']) =>
      parsed.issues.push({ line: index + 1, type, text: line })

    const colon = line.indexOf(':')
    if (colon === -1) return void issue('invalid-line')
    const name = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    if (name === 'user-agent') {
      if (!group || !readingAgents) {
        group = { userAgents: [], rules: [], crawlDelay: null }
        parsed.groups.push(group)
      }
      group.userAgents.push(value)
      readingAgents = true
    } else if (name === 'allow' || name === 'disallow') {
      readingAgents = false
      if (group) group.rules.push({ type: name, path: value })
      else issue('rule-outside-group')
    } else if (name === 'crawl-delay') {
      readingAgents = false
      const delay = Number(value)
      if (!group) issue('rule-outside-group')
      else if (value && Number.isFinite(delay)) group.crawlDelay = delay
      else issue('invalid-line')
    } else if (name === 'sitemap') {
      if (value) parsed.sitemaps.push(value)
      else issue('invalid-line')
    } else if (UNSUPPORTED.has(name)) {
      issue('unsupported-directive')
    } else if (!EXTENSIONS.has(name)) {
      issue('unknown-directive')
    }
  })
  return parsed
}

/**
 * Whether `path` matches a robots.txt pattern, where `*` is any run of characters and a final `$`
 * ends the match. Not a regular expression: these patterns come from the sites being audited, and
 * one made of stars would make a backtracking regex take forever.
 */
export function matchesRobotsPattern(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const glob = anchored ? pattern.slice(0, -1) : pattern
  let p = 0
  let g = 0
  let star = -1
  let resume = 0
  while (p < path.length) {
    // Without `$`, reaching the end of the pattern is a match: rules are prefixes.
    if (!anchored && g === glob.length) return true
    if (g < glob.length && glob[g] === '*') {
      star = g++
      resume = p
    } else if (g < glob.length && glob[g] === path[p]) {
      g++
      p++
    } else if (star !== -1) {
      g = star + 1
      p = ++resume
    } else {
      return false
    }
  }
  while (g < glob.length && glob[g] === '*') g++
  return g === glob.length
}

export interface RobotsAccess {
  /**
   * - `allowed`: nothing is disallowed.
   * - `blocked`: the whole site is disallowed.
   * - `partial`: some paths are disallowed, others are not.
   */
  access: 'allowed' | 'blocked' | 'partial'
  /** `specific` when the file names this user agent, `wildcard` when `*` applies to it. */
  matchedBy: 'specific' | 'wildcard' | 'none'
  rules: RobotsRule[]
}

/** The rules that apply to a user agent: all the groups naming it, or else those for `*`. */
function rulesFor(parsed: ParsedRobots, userAgent: string) {
  const named = (agent: string) =>
    parsed.groups.filter((group) =>
      group.userAgents.some((name) => name.toLowerCase() === agent.toLowerCase()),
    )
  const specific = userAgent === '*' ? [] : named(userAgent)
  const groups = specific.length > 0 ? specific : named('*')
  return {
    rules: groups.flatMap((group) => group.rules).filter((rule) => rule.path !== ''),
    matchedBy:
      specific.length > 0
        ? ('specific' as const)
        : groups.length > 0
          ? ('wildcard' as const)
          : ('none' as const),
  }
}

/** Whether a user agent may request a path: the longest matching rule wins, and `allow` a tie. */
export function isRobotsAllowed(parsed: ParsedRobots, userAgent: string, path: string): boolean {
  let best: RobotsRule | null = null
  for (const rule of rulesFor(parsed, userAgent).rules) {
    if (!matchesRobotsPattern(rule.path, path)) continue
    const longer = !best || rule.path.length > best.path.length
    const tieBreak = best && rule.path.length === best.path.length && rule.type === 'allow'
    if (longer || tieBreak) best = rule
  }
  return best?.type !== 'disallow'
}

const WHOLE_SITE = new Set(['/', '/*', '*'])

/** How much of a site a user agent may crawl, going by the rules that apply to it. */
export function robotsAccess(parsed: ParsedRobots, userAgent: string): RobotsAccess {
  const { rules, matchedBy } = rulesFor(parsed, userAgent)
  const disallows = rules.filter((rule) => rule.type === 'disallow')
  if (disallows.length === 0) return { access: 'allowed', matchedBy, rules }
  const allows = rules.filter((rule) => rule.type === 'allow')
  const wholeSite = disallows.some((rule) => WHOLE_SITE.has(rule.path))
  return { access: wholeSite && allows.length === 0 ? 'blocked' : 'partial', matchedBy, rules }
}

export type AiCrawlerPurpose = 'training' | 'search' | 'user'

/**
 * The user agents of AI products, by what a site gets from letting them in. `training` feeds models,
 * `search` indexes for AI answers that cite sources, and `user` fetches a page someone asked about.
 */
export const AI_CRAWLERS: readonly {
  token: string
  company: string
  purpose: AiCrawlerPurpose
}[] = [
  { token: 'GPTBot', company: 'OpenAI', purpose: 'training' },
  { token: 'OAI-SearchBot', company: 'OpenAI', purpose: 'search' },
  { token: 'ChatGPT-User', company: 'OpenAI', purpose: 'user' },
  { token: 'ClaudeBot', company: 'Anthropic', purpose: 'training' },
  { token: 'Claude-SearchBot', company: 'Anthropic', purpose: 'search' },
  { token: 'Claude-User', company: 'Anthropic', purpose: 'user' },
  { token: 'Google-Extended', company: 'Google', purpose: 'training' },
  { token: 'PerplexityBot', company: 'Perplexity', purpose: 'search' },
  { token: 'Perplexity-User', company: 'Perplexity', purpose: 'user' },
  { token: 'Applebot-Extended', company: 'Apple', purpose: 'training' },
  { token: 'Meta-ExternalAgent', company: 'Meta', purpose: 'training' },
  { token: 'Meta-ExternalFetcher', company: 'Meta', purpose: 'user' },
  { token: 'Amazonbot', company: 'Amazon', purpose: 'training' },
  { token: 'Bytespider', company: 'ByteDance', purpose: 'training' },
  { token: 'CCBot', company: 'Common Crawl', purpose: 'training' },
  { token: 'cohere-ai', company: 'Cohere', purpose: 'training' },
  { token: 'DuckAssistBot', company: 'DuckDuckGo', purpose: 'search' },
  { token: 'MistralAI-User', company: 'Mistral', purpose: 'user' },
]
