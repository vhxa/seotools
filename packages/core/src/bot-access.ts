/** Published HTTP identities only. These requests do not verify a bot's source IP. */
export const BOT_USER_AGENTS = [
  // https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers
  {
    token: 'Googlebot',
    company: 'Google',
    userAgent:
      'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  },
  // https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0
  {
    token: 'Bingbot',
    company: 'Microsoft',
    userAgent: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  },
  // https://developers.openai.com/api/docs/bots
  {
    token: 'GPTBot',
    company: 'OpenAI',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot',
  },
  // https://developers.openai.com/api/docs/bots
  {
    token: 'OAI-SearchBot',
    company: 'OpenAI',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot',
  },
  // https://developers.openai.com/api/docs/bots
  {
    token: 'ChatGPT-User',
    company: 'OpenAI',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
  },
  // https://docs.perplexity.ai/docs/resources/perplexity-crawlers
  {
    token: 'PerplexityBot',
    company: 'Perplexity',
    userAgent: 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  },
  // https://docs.perplexity.ai/docs/resources/perplexity-crawlers
  {
    token: 'Perplexity-User',
    company: 'Perplexity',
    userAgent:
      'Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)',
  },
  // https://developer.amazon.com/docs/amazonbot/amazonbot.html
  {
    token: 'Amazonbot',
    company: 'Amazon',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1) Chrome/131.0.0.0 Safari/537.36',
  },
  // https://www.commoncrawl.org/ccbot
  {
    token: 'CCBot',
    company: 'Common Crawl',
    userAgent: 'CCBot/2.0 (https://commoncrawl.org/faq/)',
  },
  // https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot
  {
    token: 'DuckAssistBot',
    company: 'DuckDuckGo',
    userAgent: 'DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)',
  },
  // https://docs.mistral.ai/robots
  {
    token: 'MistralAI-User',
    company: 'Mistral AI',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots)',
  },
  // https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers/
  { token: 'Meta-ExternalAgent', company: 'Meta', userAgent: 'meta-externalagent/1.1' },
  // https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers/
  { token: 'Meta-ExternalFetcher', company: 'Meta', userAgent: 'meta-externalfetcher/1.1' },
] as const

export const ROBOTS_ONLY_TOKENS = ['Google-Extended', 'Applebot-Extended'] as const
// No full HTTP User-Agent could be verified in first-party documentation for these tokens.
// Anthropic: https://support.claude.com/en/articles/8896518
// Cohere explicitly lists no current crawler: https://docs.cohere.com/v2/docs/cohere-web-crawlers
export const UNTESTED_BOT_TOKENS = [
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'Bytespider',
  'cohere-ai',
] as const

export interface BotAnswer {
  statusCode: number | null
  finalUrl: string | null
  errorCode: string | null
}
export interface BotVerdict {
  verdict: 'same' | 'different' | 'unknown'
  reasons: ('status-class' | 'final-url' | 'refused')[]
}
export function botAccessVerdict(baseline: BotAnswer, bot: BotAnswer): BotVerdict {
  if (
    baseline.errorCode ||
    bot.errorCode ||
    baseline.statusCode === null ||
    bot.statusCode === null ||
    !baseline.finalUrl ||
    !bot.finalUrl
  )
    return { verdict: 'unknown', reasons: [] }
  const reasons: BotVerdict['reasons'] = []
  if (Math.floor(baseline.statusCode / 100) !== Math.floor(bot.statusCode / 100))
    reasons.push('status-class')
  if (baseline.finalUrl !== bot.finalUrl) reasons.push('final-url')
  if (
    baseline.statusCode >= 200 &&
    baseline.statusCode < 300 &&
    [403, 429, 503].includes(bot.statusCode)
  )
    reasons.push('refused')
  return { verdict: reasons.length ? 'different' : 'same', reasons }
}
