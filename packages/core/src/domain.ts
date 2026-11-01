const MAX_HOST_LENGTH = 253
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
/** Letters only (`com`) or punycode (`xn--p1ai`). Rejecting numeric TLDs also rejects IPv4. */
const TLD = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

/**
 * Turns whatever the user typed or pasted into the canonical form a domain is stored in:
 * lowercase ASCII (IDNs as punycode), no scheme, no `www.`, no path, no port: `example.com`.
 * Subdomains such as `blog.example.com` are kept.
 *
 * Returns `null` when the input is not a registrable-looking hostname: IP addresses, single
 * labels like `localhost`, credentials, ports and anything that is not a valid host.
 *
 * The result always contains a dot, so a domain can never collide with an app route segment
 * such as `login` or `new`.
 */
export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase()
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  value = value.split(/[/?#]/, 1)[0] ?? ''
  if (value.endsWith('.')) value = value.slice(0, -1)
  // Whatever is left must be a bare hostname: credentials (`@`) and ports (`:`) are not domains.
  if (!value || /[@:\s]/.test(value)) return null

  let host: string
  try {
    host = new URL(`http://${value}`).hostname
  } catch {
    return null
  }

  // `www.com` is a real domain; only strip the prefix when something registrable remains.
  if (host.startsWith('www.') && host.indexOf('.', 4) !== -1) host = host.slice(4)

  if (host.length > MAX_HOST_LENGTH) return null
  const labels = host.split('.')
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null
  if (!TLD.test(labels[labels.length - 1]!)) return null
  return host
}
