import type { FindingAcceptance } from '@seotools/core/crawl/acceptance'
import type { FindingStateRecord } from '@seotools/db'

export type DismissalAcceptance = Extract<FindingAcceptance, { kind: 'dismissal' }>

/** Only the unchanged decision can supply a note; attribution always comes from the crawl. */
export function currentDismissal(
  acceptance: DismissalAcceptance,
  rows: readonly FindingStateRecord[],
): FindingStateRecord | undefined {
  return rows.find(
    (row) =>
      row.id === acceptance.id &&
      row.state === 'dismissed' &&
      acceptance.setAt !== undefined &&
      row.setAt.toISOString() === acceptance.setAt,
  )
}

/** Resolve the recorded member, never whoever now owns the mutable state row. */
export async function dismissalAttribution(
  acceptance: DismissalAcceptance,
  rows: readonly FindingStateRecord[],
  nameOf: (id: string) => Promise<string | null>,
) {
  const current = currentDismissal(acceptance, rows)
  return {
    name: acceptance.setBy ? await nameOf(acceptance.setBy) : null,
    setAt: acceptance.setAt ?? null,
    note: current?.note ?? null,
    changed: current === undefined,
  }
}
