import { describe, expect, it } from 'vitest'
import { homePriorities } from './domain-home'

const analysed = {
  pruned: false,
  pagesWithType: { issue: 2, warning: 0, opportunity: 0 },
}
const counts = [{ issue: 'no-response', pages: 2 }]

describe('homePriorities', () => {
  it('keeps unavailable and older analysis distinct from zero findings', () => {
    expect(homePriorities(null, { kind: 'none' }, [])).toBeNull()
    expect(homePriorities({ ...analysed, pagesWithType: null }, { kind: 'current' }, [])).toBeNull()
    expect(homePriorities(analysed, { kind: 'unanalysed' }, [])).toBeNull()
    expect(homePriorities(analysed, { kind: 'current' }, [])).toEqual([])
  })

  it('does not recommend findings from a stale, failed or pruned analysis', () => {
    expect(homePriorities(analysed, { kind: 'pending' }, counts)).toBeNull()
    expect(homePriorities(analysed, { kind: 'failed', message: 'retry' }, counts)).toBeNull()
    expect(homePriorities({ ...analysed, pruned: true }, { kind: 'current' }, counts)).toBeNull()
  })

  it('limits priorities (five by default) using the existing severity order and skips retired or empty findings', () => {
    expect(
      homePriorities(analysed, { kind: 'current' }, [
        { issue: 'title-too-long', pages: 40 },
        { issue: 'retired-check', pages: 100 },
        { issue: 'noindex', pages: 1 },
        { issue: 'title-too-short', pages: 50 },
        { issue: 'no-response', pages: 0 },
        { issue: 'nofollow', pages: 90 },
      ])?.map(({ issue }) => issue),
    ).toEqual(['noindex', 'nofollow', 'title-too-short', 'title-too-long'])
    expect(
      homePriorities(
        analysed,
        { kind: 'current' },
        [
          { issue: 'title-too-long', pages: 40 },
          { issue: 'noindex', pages: 1 },
          { issue: 'nofollow', pages: 90 },
        ],
        2,
      )?.map(({ issue }) => issue),
    ).toEqual(['noindex', 'nofollow'])
  })
})
