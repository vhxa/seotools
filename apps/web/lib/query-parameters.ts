/** Count each parameter at most once per URL, including repeated keys and empty values. */
export function countParameters(urls: readonly string[], counts = new Map<string, number>()) {
  for (const address of urls) {
    try {
      for (const name of new Set(new URL(address).searchParams.keys())) {
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
    } catch {
      /* Malformed legacy URLs have no readable parameters. */
    }
  }
  return counts
}
