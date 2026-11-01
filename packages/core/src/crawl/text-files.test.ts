import { describe, expect, it } from 'vitest'
import { markdownHeadings, parseAdsTxt, parseLlms, parseSecurityTxt } from './text-files'

describe('parseLlms', () => {
  it('reads the layout of llmstxt.org', () => {
    const parsed = parseLlms(
      [
        '# Acme',
        '',
        '> We make anvils.',
        '> Heavy ones.',
        '',
        'Some details.',
        '',
        '## Docs',
        '',
        '- [Quick start](https://example.com/start.md): How to begin',
        '- [API](/api.md)',
        '* not a link',
        '',
        '## Optional',
        '+ [Blog](https://example.com/blog.md)',
      ].join('\n'),
    )
    expect(parsed).toEqual({
      title: 'Acme',
      summary: 'We make anvils. Heavy ones.',
      linkCount: 3,
      sections: [
        {
          title: 'Docs',
          links: [
            { title: 'Quick start', url: 'https://example.com/start.md', notes: 'How to begin' },
            { title: 'API', url: '/api.md', notes: null },
          ],
        },
        {
          title: 'Optional',
          links: [{ title: 'Blog', url: 'https://example.com/blog.md', notes: null }],
        },
      ],
    })
  })

  it('keeps links with no section, and skips code blocks', () => {
    const parsed = parseLlms(
      ['- [One](/one.md)', '```', '- [Two](/two.md)', '# Not a title', '```'].join('\n'),
    )
    expect(parsed.title).toBeNull()
    expect(parsed.sections).toEqual([
      { title: null, links: [{ title: 'One', url: '/one.md', notes: null }] },
    ])
  })

  it('only takes the first blockquote as the summary', () => {
    const parsed = parseLlms('# T\n> First\n\nText\n\n> Second')
    expect(parsed.summary).toBe('First')
  })

  it('finds nothing in something else', () => {
    expect(parseLlms('<!doctype html><title>Oops</title>')).toEqual({
      title: null,
      summary: null,
      sections: [],
      linkCount: 0,
    })
  })
})

describe('markdownHeadings', () => {
  it('lists the headings outside code blocks', () => {
    expect(markdownHeadings('# One\n#nope\n```\n# Code\n```\n### Two\n####### Too deep')).toEqual([
      { level: 1, title: 'One' },
      { level: 3, title: 'Two' },
    ])
  })
})

describe('parseAdsTxt', () => {
  it('counts records and variables, and flags the rest', () => {
    expect(
      parseAdsTxt(
        [
          '# comment',
          'google.com, pub-1, DIRECT, f08c47fec0942fa0',
          'Google.com, pub-2, reseller # trailing',
          'other.com, 3, RESELLER',
          'CONTACT=ads@example.com',
          'other.com, 4',
          'garbage',
        ].join('\n'),
      ),
    ).toEqual({
      records: 3,
      direct: 1,
      reseller: 2,
      systems: 2,
      variables: [{ name: 'CONTACT', value: 'ads@example.com' }],
      invalidLines: [6, 7],
    })
  })
})

describe('parseSecurityTxt', () => {
  it('reads the fields, ignoring comments and the signature', () => {
    const parsed = parseSecurityTxt(
      [
        '-----BEGIN PGP SIGNED MESSAGE-----',
        'Hash: SHA256',
        '',
        '# comment',
        'Contact: mailto:security@example.com',
        'Contact: https://example.com/report',
        'Expires: 2030-01-01T00:00:00.000Z',
        'Policy: https://example.com/policy',
        '-----BEGIN PGP SIGNATURE-----',
        'Version: GnuPG',
      ].join('\n'),
    )
    expect(parsed.contacts).toEqual(['mailto:security@example.com', 'https://example.com/report'])
    expect(parsed.expires).toEqual(new Date('2030-01-01T00:00:00.000Z'))
    expect(parsed.fields.map((field) => field.name)).toEqual([
      'Contact',
      'Contact',
      'Expires',
      'Policy',
    ])
  })

  it('leaves out an expiry it cannot read', () => {
    expect(parseSecurityTxt('Expires: someday').expires).toBeNull()
  })
})
