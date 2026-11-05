import { describe, expect, it } from 'vitest'
import { CSV_BOM, CSV_EOL, csvCell, csvRow, looksLikeFormula, neutraliseFormula } from './csv'

describe('csvCell', () => {
  it('writes plain text as it is', () => {
    expect(csvCell('https://example.com/a?b=1&c=2')).toBe('https://example.com/a?b=1&c=2')
    expect(csvCell('Título: ¿qué tal? – 日本語 😀')).toBe('Título: ¿qué tal? – 日本語 😀')
  })

  it('leaves an empty cell for what is not known', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell('')).toBe('')
  })

  it('quotes what has a comma, a quote or a line break, and doubles the quotes', () => {
    expect(csvCell('a, b')).toBe('"a, b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"')
    expect(csvCell('one\r\ntwo')).toBe('"one\r\ntwo"')
    expect(csvCell('"')).toBe('""""')
  })

  it('does not quote what does not need it', () => {
    expect(csvCell('a;b')).toBe('a;b')
    expect(csvCell(' padded ')).toBe(' padded ')
  })

  it('keeps numbers numeric, negative ones included, and never treats them as formulas', () => {
    expect(csvCell(404)).toBe('404')
    expect(csvCell(0)).toBe('0')
    expect(csvCell(-1)).toBe('-1')
    expect(csvCell(1.5)).toBe('1.5')
    expect(csvCell(Number.NaN)).toBe('')
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('')
  })

  it('writes booleans in the same way everywhere', () => {
    expect(csvCell(true)).toBe('true')
    expect(csvCell(false)).toBe('false')
  })

  it('drops control characters that no cell needs', () => {
    expect(csvCell('a\u0000b\u0007c\u001fd\u007fe')).toBe('abcde')
    expect(csvCell('a\tb')).toBe('a\tb')
  })

  it('defuses a formula before quoting it', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`)
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
  })

  it('cannot be fooled by a control character in front of the formula', () => {
    expect(csvCell('\u0000=1+1')).toBe("'=1+1")
  })
})

describe('looksLikeFormula', () => {
  it.each(['=1+1', '+1', '-1', '@a', '\tx', '\rx', '\t=1', ' =1+1', '   +1', '\n=1', ' =1'])(
    'recognises %j',
    (text) => {
      expect(looksLikeFormula(text)).toBe(true)
    },
  )

  it.each([
    'https://example.com',
    'a=b',
    'a+b',
    'a-b',
    'user@example.com',
    '',
    '   ',
    '1+1',
    "'=1",
    '#hash',
    '/path',
  ])('lets %j through', (text) => {
    expect(looksLikeFormula(text)).toBe(false)
  })

  it('sees through invisible characters a spreadsheet skips', () => {
    expect(looksLikeFormula('​=1+1')).toBe(true)
    expect(looksLikeFormula('﻿=1+1')).toBe(true)
    expect(looksLikeFormula('⁠@x')).toBe(true)
  })
})

describe('neutraliseFormula', () => {
  it('puts an apostrophe in front of what a spreadsheet would run', () => {
    expect(neutraliseFormula('=cmd|"/c calc"!A1')).toBe(`'=cmd|"/c calc"!A1`)
    expect(neutraliseFormula('+1-1')).toBe("'+1-1")
    expect(neutraliseFormula('-2+3')).toBe("'-2+3")
    expect(neutraliseFormula('@x')).toBe("'@x")
    expect(neutraliseFormula('\t=1')).toBe("'\t=1")
    expect(neutraliseFormula('\r=1')).toBe("'\r=1")
    expect(neutraliseFormula('  =1')).toBe("'  =1")
  })

  it('leaves everything else alone', () => {
    expect(neutraliseFormula('Home page')).toBe('Home page')
    expect(neutraliseFormula('a =1')).toBe('a =1')
  })

  it('does it once: a cell that is already text is not changed again by being written twice', () => {
    expect(neutraliseFormula(neutraliseFormula('=1'))).toBe("'=1")
  })
})

describe('csvRow', () => {
  it('joins cells with commas and ends the record with CRLF', () => {
    expect(csvRow(['a', 'b, c', 3, null, 'd'])).toBe(`a,"b, c",3,,d${CSV_EOL}`)
    expect(CSV_EOL).toBe('\r\n')
  })

  it('writes an empty record as a line of its own', () => {
    expect(csvRow([])).toBe('\r\n')
  })

  it('has the byte order mark Excel needs to read UTF-8', () => {
    expect(new TextEncoder().encode(CSV_BOM)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]))
  })

  it('round-trips through a reader that follows RFC 4180', () => {
    const cells = ['plain', 'with,comma', 'with "quotes"', 'two\nlines', '', 'ñandú', '=1+1']
    const text = csvRow(cells)
    expect(parseCsv(text)).toEqual([
      ['plain', 'with,comma', 'with "quotes"', 'two\nlines', '', 'ñandú', "'=1+1"],
    ])
  })
})

/** A small RFC 4180 reader, to check that what is written reads back as it was meant. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\r' && text[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else field += char
  }
  return rows
}
