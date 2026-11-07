import { EXTRACTION_LIMITS, type Extracted, type Extractor } from '@seotools/core'
import { selectAll } from 'css-select'
import { isTag, isText, type AnyNode, type Element } from 'domhandler'
import { parseDocument } from 'htmlparser2'

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

const cut = (text: string) =>
  text.length > EXTRACTION_LIMITS.text ? `${text.slice(0, EXTRACTION_LIMITS.text - 1)}…` : text

/** Characters of text read from one element before collapsing, and nodes walked to find them. */
const RAW_TEXT = EXTRACTION_LIMITS.text * 4
const MAX_NODES = 20_000

/**
 * The text of an element, in document order, up to `RAW_TEXT` characters. A loop with a budget,
 * never recursion: a page can nest elements thousands deep.
 */
function textOf(element: Element): string {
  let text = ''
  let walked = 0
  const stack: AnyNode[] = [...element.children].reverse()
  while (stack.length > 0 && text.length < RAW_TEXT && walked < MAX_NODES) {
    const node = stack.pop()!
    walked++
    if (isText(node)) text += node.data
    else if (isTag(node) || 'children' in node) {
      const children = (node as Element).children
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!)
    }
  }
  return text.slice(0, RAW_TEXT)
}

/**
 * Reads what each extractor asks of a page: the text of the elements its selector matches, or one
 * of their attributes, the first few, collapsed and cut. Only runs when a domain has extractors: it
 * builds a document of the page, which plain crawling does not need. Whatever fails on a page (a
 * selector, a document too strange to read) gives nothing for that page; it never fails the crawl.
 */
export function extractCustom(html: string, extractors: readonly Extractor[]): Extracted {
  if (extractors.length === 0) return {}
  const extracted: Extracted = {}
  try {
    const document = parseDocument(html, { decodeEntities: true })
    for (const extractor of extractors) {
      try {
        const elements = selectAll<AnyNode, Element>(extractor.selector, document)
        const values: string[] = []
        for (const element of elements) {
          if (values.length >= EXTRACTION_LIMITS.values) break
          const raw =
            extractor.attribute === null
              ? textOf(element)
              : (element.attribs?.[extractor.attribute.toLowerCase()] ?? null)
          if (raw === null) continue
          const value = cut(collapse(raw.slice(0, RAW_TEXT)))
          if (value !== '') values.push(value)
        }
        if (values.length > 0) extracted[extractor.key] = values
      } catch {
        // This extractor gives nothing for this page.
      }
    }
  } catch {
    return extracted
  }
  return extracted
}
