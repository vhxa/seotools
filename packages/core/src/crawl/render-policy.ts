/** Host suffixes, never substring matches. Sources identify each vendor's loader endpoints. */
export const RENDER_OMITTED_HOSTS = [
  // Google measurement/advertising: https://developers.google.com/tag-platform/gtagjs
  ['google-analytics.com', 'analytics'],
  ['analytics.google.com', 'analytics'],
  ['doubleclick.net', 'analytics'],
  ['googleadservices.com', 'analytics'],
  ['googlesyndication.com', 'analytics'],
  // Meta Pixel: https://developers.facebook.com/docs/meta-pixel/
  ['connect.facebook.net', 'analytics'],
  // Clarity/UET: https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup
  ['clarity.ms', 'analytics'],
  ['bat.bing.com', 'analytics'],
  // Vendor installation guides: https://help.hotjar.com/ https://plausible.io/docs/
  ['hotjar.com', 'analytics'],
  ['hotjar.io', 'analytics'],
  ['plausible.io', 'analytics'],
  // https://docs.mixpanel.com/ https://segment.com/docs/ https://amplitude.com/docs/
  ['mxpnl.com', 'analytics'],
  ['mixpanel.com', 'analytics'],
  ['segment.com', 'analytics'],
  ['segment.io', 'analytics'],
  ['amplitude.com', 'analytics'],
  // https://developers.heap.io/docs/web
  ['heapanalytics.com', 'analytics'],
  // VWO/Wingify: https://help.vwo.com/hc/en-us/articles/360019422834
  ['visualwebsiteoptimizer.com', 'experiment'],
  ['vwo.com', 'experiment'],
  // Vendor deployment guides: https://docs.developers.optimizely.com/web-experimentation/
  ['optimizely.com', 'experiment'],
  // https://docs.abtasty.com/ https://developers.kameleoon.com/
  ['abtasty.com', 'experiment'],
  ['kameleoon.com', 'experiment'],
  ['kameleoon.eu', 'experiment'],
  // https://support.convert.com/ https://experienceleague.adobe.com/en/docs/target
  ['convertexperiments.com', 'experiment'],
  ['convert.com', 'experiment'],
  ['tt.omtrdc.net', 'experiment'],
  ['adobetarget.com', 'experiment'],
  // https://dy.dev/ https://docs.monetate.com/
  ['dynamicyield.com', 'experiment'],
  ['monetate.net', 'experiment'],
] as const

/** Same-host paths: do not suppress a site's other resources or GTM's gtm.js loader. */
export const RENDER_OMITTED_PATHS = [
  { host: 'googletagmanager.com', path: '/gtag/js', reason: 'analytics' },
  { host: 'facebook.com', path: '/tr', reason: 'analytics' },
  // Matomo and its former Piwik name: https://developer.matomo.org/api-reference/tracking-api
  { path: '/matomo.php', reason: 'analytics' },
  { path: '/matomo.js', reason: 'analytics' },
  { path: '/piwik.php', reason: 'analytics' },
  { path: '/piwik.js', reason: 'analytics' },
] as const

/** Fail closed on resource classes not required for a textual DOM. */
export const RENDER_OMITTED_TYPES = [
  'image',
  'media',
  'font',
  'websocket',
  'eventsource',
  'ping',
  'csp-report',
  'cspviolationreport',
  'manifest',
  'prefetch',
  'other',
  'texttrack',
  'signedexchange',
  'fedcm',
] as const
export type RenderOmitReason = 'analytics' | 'experiment' | 'type' | 'domain-list'
export type RenderRequestDecision =
  { action: 'fetch' | 'robots' | 'scheme' } | { action: 'omit'; reason: RenderOmitReason }

const allowedTypes = new Set(['document', 'script', 'stylesheet', 'xhr', 'fetch', 'preflight'])
const hostMatches = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`)

export function renderRequestDecision(input: {
  url: string
  resourceType: string
  trackedSite: boolean
  allowedByRobots: (url: string) => boolean | 'unknown'
  extraOmittedHosts?: readonly string[]
}): RenderRequestDecision {
  let url: URL
  try {
    url = new URL(input.url)
  } catch {
    return { action: 'scheme' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { action: 'scheme' }
  if (!allowedTypes.has(input.resourceType.toLowerCase())) return { action: 'omit', reason: 'type' }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  for (const [suffix, reason] of RENDER_OMITTED_HOSTS) {
    if (hostMatches(host, suffix)) return { action: 'omit', reason }
  }
  for (const rule of RENDER_OMITTED_PATHS) {
    if (
      (!('host' in rule) || hostMatches(host, rule.host)) &&
      ('host' in rule
        ? url.pathname.toLowerCase().startsWith(rule.path)
        : url.pathname
            .toLowerCase()
            .split('/')
            .some((segment) => segment.startsWith(rule.path.slice(1))))
    ) {
      return { action: 'omit', reason: rule.reason }
    }
  }
  if (
    (input.extraOmittedHosts ?? []).some((suffix) =>
      hostMatches(host, suffix.toLowerCase().replace(/\.$/, '')),
    )
  ) {
    return { action: 'omit', reason: 'domain-list' }
  }
  if (input.trackedSite && input.allowedByRobots(input.url) === false) return { action: 'robots' }
  return { action: 'fetch' }
}
