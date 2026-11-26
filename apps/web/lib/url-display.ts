/**
 * How a URL of the domain reads in a list: on the primary origin (`https://<host>`, exactly) only
 * its path and query, which is what tells one URL from another; on any other origin (`http`, the
 * `www.` variant, another host or port) the whole address, so the variants stay distinguishable.
 * It only shortens what is shown: the title, links and copy actions keep the full URL.
 */
export function displayUrl(url: string, host: string): string {
  const origin = `https://${host}`
  if (!url.startsWith(origin)) return url
  const rest = url.slice(origin.length)
  if (rest === '') return '/'
  // `https://example.com.evil.org/` or `https://example.com:8443/` are other origins.
  if (rest.startsWith('/')) return rest
  if (rest.startsWith('?') || rest.startsWith('#')) return `/${rest}`
  return url
}
