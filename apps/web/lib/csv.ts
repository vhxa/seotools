/**
 * Writing CSV that opens the same in Excel, Numbers, LibreOffice, Google Sheets and a script.
 * Pure: no Node imports.
 *
 * - RFC 4180: fields separated by commas, records by CRLF, and a field with a comma, a quote or a
 *   line break quoted, with its quotes doubled.
 * - UTF-8 with a byte order mark, which is how Excel knows the accents are not Windows-1252.
 * - What a site wrote (URLs, titles, anchor text, error messages) is untrusted, and a spreadsheet
 *   runs a cell that starts like a formula: `neutraliseFormula` defuses it. Numbers given as
 *   numbers are not text and are never touched, so a status stays a number.
 */

/** The byte order mark, written once at the start of a file. */
export const CSV_BOM = '\uFEFF'
export const CSV_EOL = '\r\n'

/** What a cell can hold. `null` and `undefined` are an empty cell: the value is not known. */
export type CsvCell = string | number | boolean | null | undefined

/** Characters a spreadsheet starts a formula (or a command) with. */
const FORMULA_START = new Set(['=', '+', '-', '@'])
/**
 * Leading characters a spreadsheet skips before reading a formula: whitespace, control characters
 * and invisible formatting ones (zero-width spaces, the byte order mark).
 */
const LEADING_SPACE = /^[\p{White_Space}\p{Cc}\p{Cf}]*/u

/**
 * Whether a spreadsheet could take the text for a formula: it starts (after any leading
 * whitespace or invisible characters) with `=`, `+`, `-` or `@`, or it starts with a tab or a
 * carriage return, which Excel also treats as the start of one.
 */
export function looksLikeFormula(text: string): boolean {
  if (text.startsWith('\t') || text.startsWith('\r')) return true
  const rest = text.slice(LEADING_SPACE.exec(text)?.[0].length ?? 0)
  return rest !== '' && FORMULA_START.has(rest[0] as string)
}

/**
 * The text with a leading `'` if a spreadsheet would run it, so that it opens as the text it is.
 * The apostrophe stays visible in a CSV: that is the cost of not executing a stranger's formula.
 */
export const neutraliseFormula = (text: string): string =>
  looksLikeFormula(text) ? `'${text}` : text

/** Control characters other than tab and line breaks: no use in a cell, and some break readers. */
const CONTROL = /[^\P{Cc}\t\n\r]/gu

/** One cell, ready to be joined with commas. */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const text = neutraliseFormula(value.replace(CONTROL, ''))
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** One record, ended with CRLF. */
export const csvRow = (cells: readonly CsvCell[]): string =>
  `${cells.map(csvCell).join(',')}${CSV_EOL}`
