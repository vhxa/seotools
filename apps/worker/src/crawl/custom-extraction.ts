import { EXTRACTION_LIMITS, type Extracted, type Extractor } from '@seotools/core'
import { selectAll } from 'css-select'
import type { AnyNode, Element } from 'domhandler'
import { textContent } from 'domutils'
import { parseDocument } from 'htmlparser2'

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

const cut = (text: string) =>
  text.length > EXTRACTION_LIMITS.text ? `${text.slice(0, EXTRACTION_LIMITS.text - 1)}…` : text

/**
 * Reads what each extractor asks of a page: the text of the elements its selector matches, or one
 * of their attributes, the first few, collapsed and cut. Only runs when a domain has extractors: it
 * builds a document of the page, which plain crawling does not need. A selector that fails on a page
 * gives nothing for that page; it never fails the crawl.
 */
export function extractCustom(html: string, extractors: readonly Extractor[]): Extracted {
  if (extractors.length === 0) return {}
  const document = parseDocument(html, { decodeEntities: true })
  const extracted: Extracted = {}
  for (const extractor of extractors) {
    let elements: Element[]
    try {
      elements = selectAll<AnyNode, Element>(extractor.selector, document)
    } catch {
      continue
    }
    const values: string[] = []
    for (const element of elements) {
      if (values.length >= EXTRACTION_LIMITS.values) break
      const raw =
        extractor.attribute === null
          ? textContent(element)
          : (element.attribs?.[extractor.attribute.toLowerCase()] ?? null)
      if (raw === null) continue
      const value = cut(collapse(raw.slice(0, EXTRACTION_LIMITS.text * 4)))
      if (value !== '') values.push(value)
    }
    if (values.length > 0) extracted[extractor.key] = values
  }
  return extracted
}
