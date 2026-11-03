const BITS = 64
const SHINGLE = 3
/** Enough to say what a page is about; the rest would only cost time. */
const MAX_WORDS = 20_000

/** FNV-1a. Two seeds give the 64 bits JavaScript has no fast integer for. */
function fnv1a(text: string, seed: number): number {
  let hash = seed
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** The simhash of a text, as 16 hexadecimal digits: similar texts differ in few of its bits. */
export function simhash(words: readonly string[]): string {
  const weights = new Int32Array(BITS)
  const list = words.slice(0, MAX_WORDS).map((word) => word.toLowerCase())
  const shingles = Math.max(1, list.length - SHINGLE + 1)
  for (let i = 0; i < shingles; i++) {
    const shingle = list.slice(i, i + SHINGLE).join(' ')
    const high = fnv1a(shingle, 0x811c9dc5)
    const low = fnv1a(shingle, 0x7a3e1f2b)
    for (let bit = 0; bit < 32; bit++) {
      weights[bit]! += (high >>> bit) & 1 ? 1 : -1
      weights[bit + 32]! += (low >>> bit) & 1 ? 1 : -1
    }
  }
  let high = 0
  let low = 0
  for (let bit = 0; bit < 32; bit++) {
    if (weights[bit]! > 0) high |= 1 << bit
    if (weights[bit + 32]! > 0) low |= 1 << bit
  }
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, '0')
  return hex(high) + hex(low)
}

function popCount32(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24
}

/** How many bits two simhashes differ in. */
export function hammingDistance(a: string, b: string): number {
  const high = parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)
  const low = parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16)
  return popCount32(high) + popCount32(low)
}

/** Bits two texts may differ in and still count as near copies: roughly 95% of the same text. */
const NEAR_DISTANCE = 6
/** Cutting the hash in one more part than bits allowed means that two near ones share a part. */
const BANDS = NEAR_DISTANCE + 1
const BAND_BITS = Math.floor(BITS / BANDS)
/** A template repeated thousands of times should not make this take minutes. */
const MAX_BUCKET = 2000

/**
 * Most near copies kept per item. A page with more is said to have this many or more: what is shown
 * of them is only a sample, and a template copied thousands of times would make every item hold
 * thousands of others.
 */
export const MAX_NEAR_PARTNERS = 20

/**
 * Which items are near copies of another one, and of which (up to `MAX_NEAR_PARTNERS` each), without
 * comparing every pair. Items with the same `group` are exact copies of each other, which is a
 * different finding, so they do not count. An item that has no near copy is not in the result.
 */
export function findNearDuplicates<T extends { simhash: string; group: string | null }>(
  items: readonly T[],
): Map<T, Set<T>> {
  const near = new Map<T, Set<T>>()
  const pair = (item: T, partner: T) => {
    let partners = near.get(item)
    if (!partners) near.set(item, (partners = new Set()))
    if (partners.size < MAX_NEAR_PARTNERS) partners.add(partner)
  }
  const mask = (1n << BigInt(BAND_BITS)) - 1n
  for (let band = 0; band < BANDS; band++) {
    const shift = BigInt(band * BAND_BITS)
    const buckets = new Map<bigint, T[]>()
    for (const item of items) {
      const key = (BigInt(`0x${item.simhash}`) >> shift) & mask
      const bucket = buckets.get(key)
      if (!bucket) buckets.set(key, [item])
      else if (bucket.length < MAX_BUCKET) bucket.push(item)
    }
    for (const bucket of buckets.values()) {
      for (let i = 0; i < bucket.length; i++) {
        const a = bucket[i]!
        for (let j = i + 1; j < bucket.length; j++) {
          const b = bucket[j]!
          if (a.group !== null && a.group === b.group) continue
          if (hammingDistance(a.simhash, b.simhash) <= NEAR_DISTANCE) {
            pair(a, b)
            pair(b, a)
          }
        }
      }
    }
  }
  return near
}
