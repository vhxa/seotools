import { parse } from 'css-what'
import { z } from 'zod'

/**
 * Custom extraction: values a domain asks the crawler to read from every page with a CSS selector,
 * such as a price, an author or a product id. What a page said, bounded, kept with the page; never
 * a regex. Pure (`css-what` only parses selectors), so client components can import it.
 */
export const EXTRACTION_LIMITS = {
  extractors: 10,
  name: 40,
  selector: 200,
  attribute: 40,
  /** Values kept per extractor and page, and characters per value. */
  values: 5,
  text: 300,
} as const

export interface Extractor {
  /** Stable key, as the values are stored under it: lowercase letters, digits and `-`. */
  key: string
  name: string
  selector: string
  /** The attribute to read (`content`, `href`…); `null` reads the element's text. */
  attribute: string | null
}

/** What a page said for each extractor, by key. A key absent: nothing matched. */
export type Extracted = Record<string, string[]>

const KEY = /^[a-z0-9][a-z0-9-]{0,39}$/
const ATTRIBUTE = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/

/** Whether a selector can be used: valid CSS, without pseudo-elements, of a reasonable size. */
export function validSelector(selector: string): boolean {
  if (selector.trim() === '' || selector.length > EXTRACTION_LIMITS.selector) return false
  try {
    const parsed = parse(selector)
    return parsed.every((group) => group.every((token) => token.type !== 'pseudo-element'))
  } catch {
    return false
  }
}

export const extractorSchema = z.object({
  key: z.string().regex(KEY),
  name: z.string().trim().min(1).max(EXTRACTION_LIMITS.name),
  selector: z.string().trim().refine(validSelector),
  attribute: z.string().trim().max(EXTRACTION_LIMITS.attribute).regex(ATTRIBUTE).nullable(),
})

export const extractorsSchema = z
  .array(extractorSchema)
  .max(EXTRACTION_LIMITS.extractors)
  .refine((list) => new Set(list.map((item) => item.key)).size === list.length)

/** A key for a name: `Product price` → `product-price`, made unique among `taken`. */
export function extractorKey(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'value'
  let key = base
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`
  return key
}
