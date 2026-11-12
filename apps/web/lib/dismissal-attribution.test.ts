import { describe, expect, it } from 'vitest'
import type { FindingStateRecord } from '@seotools/db'
import {
  currentDismissal,
  dismissalAttribution,
  type DismissalAcceptance,
} from './dismissal-attribution'

const acceptance: DismissalAcceptance = {
  kind: 'dismissal',
  id: 'decision',
  state: 'dismissed',
  scope: 'domain',
  setBy: 'alice',
  setAt: '2026-11-12T00:00:00.000Z',
}
const row: FindingStateRecord = {
  id: 'decision',
  domainId: 'domain',
  issue: 'title-missing',
  urlHash: null,
  targetKey: '*',
  state: 'dismissed',
  setBy: 'alice',
  setAt: new Date(acceptance.setAt!),
  note: 'Alice note',
}
const nameOf = async (id: string) => ({ alice: 'Alice', bob: 'Bob' })[id as 'alice' | 'bob'] ?? null

describe('historical dismissal attribution', () => {
  it('keeps Alice and her recorded time after Bob changes progress, note, or restores the decision', async () => {
    expect(await dismissalAttribution(acceptance, [row], nameOf)).toEqual({
      name: 'Alice',
      setAt: acceptance.setAt,
      note: 'Alice note',
      changed: false,
    })
    for (const rows of [
      [{ ...row, state: 'in-progress' as const, setBy: 'bob', note: 'Bob note' }],
      [{ ...row, setAt: new Date('2026-11-13T00:00:00Z'), setBy: 'bob', note: 'Bob note' }],
      [{ ...row, id: 'replacement', setBy: 'bob' }],
      [],
    ]) {
      expect(await dismissalAttribution(acceptance, rows, nameOf)).toEqual({
        name: 'Alice',
        setAt: acceptance.setAt,
        note: null,
        changed: true,
      })
    }
  })
  it('returns a missing member without borrowing the current decision maker, and handles older records', async () => {
    expect(await dismissalAttribution(acceptance, [row], async () => null)).toMatchObject({
      name: null,
      setAt: acceptance.setAt,
    })
    expect(
      currentDismissal({ kind: 'dismissal', scope: 'url', id: row.id, state: 'dismissed' }, [row]),
    ).toBeUndefined()
  })
})
