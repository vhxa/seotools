/**
 * Same served document/resources => same outcome, except time, crypto randomness and changing
 * answers. Each frame starts the same URL-seeded PRNG; the real clock is deliberately retained.
 * Puppeteer registers this at document start, including attached/navigated OOPIFs.
 */
export function seedPageRandom(url: string) {
  let state = 2166136261
  for (let i = 0; i < url.length; i++) state = Math.imul(state ^ url.charCodeAt(i), 16777619)
  Math.random = () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
