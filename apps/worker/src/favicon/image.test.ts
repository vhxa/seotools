import { describe, expect, it } from 'vitest'
import { sniffImage } from './image'

const bytes = (...values: number[]) => Buffer.from(values)

describe('sniffImage', () => {
  it.each([
    ['PNG', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0), 'image/png'],
    ['ICO', bytes(0, 0, 1, 0, 2, 0, 16, 16), 'image/x-icon'],
    ['GIF', Buffer.from('GIF89a....'), 'image/gif'],
    ['JPEG', bytes(0xff, 0xd8, 0xff, 0xe0, 0), 'image/jpeg'],
    ['WebP', Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '), 'image/webp'],
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml'],
    [
      'SVG with prolog, comment and doctype',
      Buffer.from(
        '﻿<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg viewBox="0 0 1 1"/>',
      ),
      'image/svg+xml',
    ],
  ])('recognises %s', (_name, data, type) => {
    expect(sniffImage(data)).toBe(type)
  })

  it.each([
    ['an HTML error page', Buffer.from('<!doctype html><html><body><svg></svg></body></html>')],
    ['plain text', Buffer.from('not found')],
    ['an ICO with no images', bytes(0, 0, 1, 0, 0, 0)],
    ['a CUR cursor', bytes(0, 0, 2, 0, 1, 0)],
    ['nothing', Buffer.alloc(0)],
  ])('rejects %s', (_name, data) => {
    expect(sniffImage(data)).toBeNull()
  })
})
