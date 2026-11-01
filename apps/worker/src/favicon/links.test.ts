import { describe, expect, it } from 'vitest'
import { extractIconLinks } from './links'

const page = (head: string) => `<!doctype html><html><head>${head}</head><body></body></html>`
const urls = (head: string, base = 'https://example.com/blog/post') =>
  extractIconLinks(page(head), base)

describe('extractIconLinks', () => {
  it('resolves icon URLs against the page', () => {
    expect(
      urls(`<link rel="icon" href="/favicon.png"><link rel="shortcut icon" href="img/a.ico">`),
    ).toEqual(['https://example.com/favicon.png', 'https://example.com/blog/img/a.ico'])
  })

  it('honours <base href>', () => {
    expect(
      urls(`<base href="https://cdn.example.com/assets/"><link rel="icon" href="i.png">`),
    ).toEqual(['https://cdn.example.com/assets/i.png'])
  })

  it('prefers scalable icons, then the smallest that is sharp enough, then smaller ones', () => {
    expect(
      urls(`
        <link rel="icon" sizes="16x16" href="/16.png">
        <link rel="icon" sizes="192x192" href="/192.png">
        <link rel="icon" sizes="32x32" href="/32.png">
        <link rel="icon" type="image/svg+xml" href="/icon.svg">
        <link rel="icon" sizes="48x48" href="/48.png">
      `),
    ).toEqual([
      'https://example.com/icon.svg',
      'https://example.com/32.png',
      'https://example.com/48.png',
      'https://example.com/192.png',
      'https://example.com/16.png',
    ])
  })

  it('treats .svg files and sizes="any" as scalable', () => {
    expect(
      urls(`<link rel="icon" href="/32.png" sizes="32x32"><link rel="icon" href="/a.svg?v=2">`)[0],
    ).toBe('https://example.com/a.svg?v=2')
    expect(
      urls(
        `<link rel="icon" href="/32.png" sizes="32x32"><link rel="icon" href="/a.ico" sizes="any">`,
      )[0],
    ).toBe('https://example.com/a.ico')
  })

  it('ranks the real favicon above the apple-touch-icon, which is 180 px unless it says otherwise', () => {
    expect(
      urls(`
        <link rel="apple-touch-icon" href="/touch.png">
        <link rel="icon" href="/plain.png">
      `),
    ).toEqual(['https://example.com/plain.png', 'https://example.com/touch.png'])
    expect(
      urls(`
        <link rel="icon" sizes="16x16" href="/small.png">
        <link rel="apple-touch-icon-precomposed" sizes="57x57" href="/touch.png">
      `),
    ).toEqual(['https://example.com/touch.png', 'https://example.com/small.png'])
  })

  it('ignores what is not an icon', () => {
    expect(
      urls(`
        <link rel="stylesheet" href="/a.css">
        <link rel="mask-icon" href="/mask.svg">
        <link rel="icon">
        <link rel="icon" href="javascript:alert(1)">
        <link rel="icon" href="ftp://example.com/a.ico">
      `),
    ).toEqual([])
  })

  it('keeps embedded data: icons and removes duplicates', () => {
    const data =
      'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E'
    expect(
      urls(
        `<link rel="icon" href="${data}"><link rel="icon" href="/a.png"><link rel="shortcut icon" href="/a.png">`,
      ),
    ).toEqual([data, 'https://example.com/a.png'])
  })

  it('does not return more than a handful', () => {
    const many = Array.from({ length: 20 }, (_, i) => `<link rel="icon" href="/${i}.png">`).join('')
    expect(urls(many)).toHaveLength(6)
  })
})
