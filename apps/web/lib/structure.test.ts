import { describe, expect, it } from 'vitest'
import type { StructureUrl } from '@seotools/db'
import {
  buildStructure,
  countsOf,
  directoriesOf,
  emptyCounts,
  parseStructurePath,
  pathOfDirectories,
  STRUCTURE_BATCH,
  STRUCTURE_CHILDREN,
  STRUCTURE_DEPTH,
  STRUCTURE_TRACKED_PER_NODE,
  StructureTree,
} from './structure'

const none = { prefixes: [], unprefixed: false }
const page = (n: number): StructureUrl['statusCode'] => (n === 0 ? 200 : n)
const url = (path: string, overrides: Partial<StructureUrl> = {}): StructureUrl => ({
  urlHash: path,
  url: `https://acme.com${path}`,
  kind: 'page',
  statusCode: page(0),
  state: 'done',
  ...overrides,
})
const one = { ...emptyCounts(), pages: 1 }

describe('directoriesOf', () => {
  it('lists the directories a path is in, never the file', () => {
    expect(directoriesOf('/')).toEqual([])
    expect(directoriesOf('/about')).toEqual([])
    expect(directoriesOf('/blog/')).toEqual(['blog'])
    expect(directoriesOf('/blog/post')).toEqual(['blog'])
    expect(directoriesOf('/a/b/c/d.html')).toEqual(['a', 'b', 'c'])
    expect(directoriesOf('/a//b/x')).toEqual(['a', 'b'])
  })
})

describe('parseStructurePath', () => {
  it('reads a plain path and ignores what is not one', () => {
    expect(parseStructurePath('/blog/en/')).toEqual(['blog', 'en'])
    expect(parseStructurePath('/blog')).toEqual(['blog'])
    expect(parseStructurePath('blog')).toEqual([])
    expect(parseStructurePath(undefined)).toEqual([])
    expect(parseStructurePath(['/a/', '/b/'])).toEqual(['a'])
    expect(parseStructurePath(`/${'x/'.repeat(100)}`)).toHaveLength(16)
    expect(pathOfDirectories([])).toBe('/')
    expect(pathOfDirectories(['a', 'b'])).toBe('/a/b/')
  })
})

describe('StructureTree', () => {
  it('adds URLs up by directory, cumulatively', () => {
    const tree = new StructureTree([], none)
    for (const path of ['/', '/about', '/blog/', '/blog/a', '/blog/b', '/shop/x/y', '/shop/z']) {
      tree.add(path, one)
    }
    const { tree: root } = tree.result()
    expect(root.path).toBe('/')
    expect(root.counts.pages).toBe(7)
    expect(root.children.map(({ path, counts }) => [path, counts.pages])).toEqual([
      ['/blog/', 3],
      ['/shop/', 2],
    ])
    const shop = root.children[1]!
    expect(shop.children.map(({ path, counts }) => [path, counts.pages])).toEqual([['/shop/x/', 1]])
    expect(root.other).toBeNull()
  })

  it('roots at a directory and ignores what is outside it', () => {
    const tree = new StructureTree(['blog'], none)
    for (const path of ['/blog/a', '/blog/2024/x', '/blog/2024/y', '/blogger/z', '/shop/a']) {
      tree.add(path, one)
    }
    const { tree: root } = tree.result()
    expect(root.path).toBe('/blog/')
    expect(root.counts.pages).toBe(3)
    expect(root.children.map(({ path, counts }) => [path, counts.pages])).toEqual([
      ['/blog/2024/', 2],
    ])
  })

  it('stops at the depth and says the node has more below', () => {
    const tree = new StructureTree([], none)
    tree.add('/a/b/c/d/e/file', one)
    tree.add('/a/b/c/page', one)
    const { tree: root } = tree.result()
    expect(STRUCTURE_DEPTH).toBe(3)
    const c = root.children[0]!.children[0]!.children[0]!
    expect(c.path).toBe('/a/b/c/')
    expect(c.counts.pages).toBe(2)
    expect(c.children).toEqual([])
    expect(c.deeper).toBe(true)
    expect(root.children[0]!.deeper).toBe(false)
  })

  it('shows the busiest directories and folds the rest into other', () => {
    const tree = new StructureTree([], none)
    for (let i = 0; i < STRUCTURE_CHILDREN + 5; i++) {
      for (let n = 0; n <= i; n++) tree.add(`/d${String(i).padStart(2, '0')}/p${n}`, one)
    }
    const { tree: root } = tree.result()
    expect(root.children).toHaveLength(STRUCTURE_CHILDREN)
    // Busiest first.
    expect(root.children[0]!.name).toBe(`d${STRUCTURE_CHILDREN + 4}`)
    expect(root.other?.directories).toBe(5)
    const total = root.children.reduce((sum, child) => sum + child.counts.pages, 0)
    expect(total + root.other!.counts.pages).toBe(root.counts.pages)
  })

  it('keeps memory bounded and the totals exact when a directory has endless children', () => {
    const tree = new StructureTree([], none)
    const many = STRUCTURE_TRACKED_PER_NODE + 300
    for (let i = 0; i < many; i++) tree.add(`/p/item-${i}/page`, one)
    const { tree: root } = tree.result()
    const p = root.children[0]!
    expect(p.counts.pages).toBe(many)
    expect(p.children).toHaveLength(STRUCTURE_CHILDREN)
    // 300 directories had no room: they are only known to exist.
    expect(p.other?.directories).toBeNull()
    const counted = p.children.reduce((sum, child) => sum + child.counts.pages, 0)
    expect(counted + p.other!.counts.pages).toBe(many)
  })

  it('breaks the site down by declared language directory, whatever the root', () => {
    const tree = new StructureTree(['es'], { prefixes: ['/en', '/es'], unprefixed: true })
    for (const path of ['/en/a', '/en/b/c', '/es/a', '/es/b/', '/about', '/espanol/x', '/']) {
      tree.add(path, one)
    }
    const { languages } = tree.result()
    expect(languages.map(({ prefix, counts }) => [prefix, counts.pages])).toEqual([
      ['/en', 2],
      ['/es', 2],
      [null, 3],
    ])
  })

  it('lists no language when none is declared, and deduces none', () => {
    const tree = new StructureTree([], none)
    tree.add('/en/a', one)
    expect(tree.result().languages).toEqual([{ prefix: null, counts: { ...one } }])
  })
})

describe('countsOf', () => {
  const audited = { participation: 'audited', indexability: 'indexable' } as const
  it('counts pages, errors and the types of finding once each', () => {
    expect(
      countsOf(url('/a'), {
        audit: audited,
        issues: [
          { issue: 'title-missing' },
          { issue: 'title-missing' },
          { issue: 'title-too-long' },
        ],
      }),
    ).toMatchObject({ pages: 1, errors: 0, issue: 0, warning: 1, opportunity: 1 })
    // A search-result finding on a page that cannot be indexed is listed, never counted.
    expect(
      countsOf(url('/a'), {
        audit: { participation: 'audited', indexability: 'not-indexable' },
        issues: [{ issue: 'title-too-long' }],
      }),
    ).toMatchObject({ pages: 1, opportunity: 0 })
    expect(countsOf(url('/gone', { statusCode: 404 }), null)).toMatchObject({
      pages: 0,
      errors: 1,
    })
    expect(countsOf(url('/boom', { statusCode: null }), null)).toMatchObject({ errors: 1 })
    expect(countsOf(url('/old', { kind: 'redirect', statusCode: 301 }), null)).toEqual(
      emptyCounts(),
    )
    expect(countsOf(url('/q', { state: 'queued', statusCode: null }), null).errors).toBe(0)
  })

  it('leaves out pages the audit excluded and findings that are secondary', () => {
    const issues = [{ issue: 'title-missing' as const }]
    expect(
      countsOf(url('/a'), {
        audit: { participation: 'excluded', indexability: 'indexable' },
        issues,
      }),
    ).toMatchObject({ pages: 1, issue: 0, warning: 0, opportunity: 0 })
    expect(countsOf(url('/a'), { audit: undefined, issues })).toMatchObject({ pages: 1 })
    expect(countsOf(url('/a'), null)).toMatchObject({ pages: 1, issue: 0, warning: 0 })
  })
})

describe('buildStructure', () => {
  it('reads the crawl in batches, never all at once', async () => {
    const total = STRUCTURE_BATCH * 2 + 7
    const all = Array.from({ length: total }, (_, i) =>
      url(`/d${i % 4}/p${i}`, { urlHash: String(i).padStart(8, '0') }),
    )
    let biggest = 0
    const result = await buildStructure({
      root: [],
      languages: none,
      nextBatch: async (after, limit) => {
        const batch = all.filter(({ urlHash }) => after === null || urlHash > after).slice(0, limit)
        biggest = Math.max(biggest, batch.length)
        return batch
      },
      analysisOf: async () => null,
    })
    expect(biggest).toBeLessThanOrEqual(STRUCTURE_BATCH)
    expect(result.tree.counts.pages).toBe(total)
    expect(result.tree.children).toHaveLength(4)
  })
})
