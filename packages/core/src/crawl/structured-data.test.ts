import { describe, expect, it } from 'vitest'
import { checkStructuredData } from './structured-data'

describe('checkStructuredData', () => {
  it('says what a rich result type lacks, required apart from recommended', () => {
    expect(checkStructuredData([{ '@type': 'Event', name: 'Concert' }])).toEqual({
      types: ['Event'],
      problems: [
        { type: 'Event', level: 'required', missing: ['startDate', 'location'] },
        {
          type: 'Event',
          level: 'recommended',
          missing: ['description', 'endDate', 'image', 'offers', 'organizer', 'eventStatus'],
        },
      ],
    })
  })

  it('takes one of several alternatives as enough, and empty values as missing', () => {
    const product = { '@type': 'Product', name: 'Robe', review: [], aggregateRating: { x: 1 } }
    expect(checkStructuredData([product]).problems.filter((p) => p.level === 'required')).toEqual(
      [],
    )
    expect(checkStructuredData([{ '@type': 'Product', name: ' ' }]).problems[0]).toEqual({
      type: 'Product',
      level: 'required',
      missing: ['name', 'offers | review | aggregateRating'],
    })
  })

  it('reads lists, graphs, several types and schema.org prefixes, and ignores unknown types', () => {
    const report = checkStructuredData([
      [{ '@type': 'WebSite', name: 'Aire' }],
      {
        '@graph': [
          { '@type': ['https://schema.org/BreadcrumbList'], itemListElement: [{ position: 1 }] },
          { '@type': 'schema:DaySpa', name: 'Aire', address: 'Calle 1' },
        ],
      },
    ])
    expect(report.types).toEqual(['WebSite', 'BreadcrumbList', 'DaySpa'])
    expect(report.problems).toEqual([
      {
        type: 'DaySpa',
        level: 'recommended',
        missing: ['telephone', 'url', 'image', 'openingHoursSpecification', 'geo'],
      },
    ])
  })

  it('bounds what it looks at', () => {
    const many = Array.from({ length: 500 }, () => ({ '@type': 'Event' }))
    const report = checkStructuredData([many])
    expect(report.problems.length).toBeLessThanOrEqual(20)
  })
})

describe('what a page cannot make the check do', () => {
  it('judges lists nested thousands deep without failing', () => {
    let nested: unknown = { '@type': 'Product' }
    for (let i = 0; i < 20_000; i++) nested = [nested]
    expect(() => checkStructuredData([JSON.parse(JSON.stringify(nested))])).not.toThrow()
  })

  it('stops at its budget on a huge flat list', () => {
    const many = Array.from({ length: 200_000 }, () => ({ '@type': 'Thing' }))
    const report = checkStructuredData([many])
    expect(report.types).toEqual(['Thing'])
  })

  it('still finds the nodes of a graph before the node that holds it', () => {
    const report = checkStructuredData([
      { '@type': 'WebPage', '@graph': [{ '@type': 'Product' }, { '@type': 'Organization' }] },
    ])
    expect(report.types).toEqual(['Product', 'Organization', 'WebPage'])
  })
})
