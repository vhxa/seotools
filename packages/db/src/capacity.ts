import {
  CAPACITY_DISMISSED_KEY,
  CAPACITY_HARDWARE_KEY,
  CAPACITY_KEY,
  CAPACITY_UPGRADE_KEY,
  MIB,
  capacityHardwareSchema,
  capacitySchema,
  recommendedCapacity,
  type Capacity,
  type CapacityHardware,
  type CrawlCapacityMetrics,
} from '@seotools/core/capacity'
import type { Database, CrawlRendering, CrawlUrlRender } from './types'
import { parseJson } from './mapping'

export interface CapacityUpgrade {
  from: Capacity | null
  to: Capacity
  domains: { host: string; from: number; to: number }[]
}

export interface CapacityRepository {
  initialize(recommended: Capacity): Promise<void>
}

export async function readCapacity(db: Pick<Database, 'settings'>) {
  const stored = await db.settings.get(CAPACITY_KEY)
  return capacitySchema.safeParse(parseJson(stored?.value ?? null)).data ?? null
}

export async function readCapacityContext(db: Pick<Database, 'settings'>) {
  const [capacity, detected] = await Promise.all([
    readCapacity(db),
    db.settings.get(CAPACITY_HARDWARE_KEY),
  ])
  const hardware = capacityHardwareSchema.safeParse(parseJson(detected?.value ?? null)).data ?? null
  return { capacity, hardware, recommended: hardware ? recommendedCapacity(hardware) : null }
}

export async function readCapacitySettings(db: Pick<Database, 'settings'>) {
  const [context, upgrade, dismissed] = await Promise.all([
    readCapacityContext(db),
    db.settings.get(CAPACITY_UPGRADE_KEY),
    db.settings.get(CAPACITY_DISMISSED_KEY),
  ])
  return {
    ...context,
    upgrade: dismissed ? null : (parseJson(upgrade?.value ?? null) as CapacityUpgrade | null),
  }
}

export function publishCapacityHardware(
  db: Pick<Database, 'settings'>,
  hardware: CapacityHardware,
) {
  return db.settings.set(CAPACITY_HARDWARE_KEY, JSON.stringify(hardware), false)
}

export function recordRenderSlots(raw: string | null, slots: readonly number[]): string | null {
  if (!slots.length) return raw
  const rendering = parseJson(raw) as CrawlRendering | null
  if (rendering?.mode !== 'rendered') return raw
  return JSON.stringify({
    ...rendering,
    slots: [...new Set([...(rendering.slots ?? []), ...slots])].sort((a, b) => a - b),
  })
}

type Histogram = Map<number, number>
function record(histogram: Histogram, value: number | null | undefined, count = 1) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
    histogram.set(value, (histogram.get(value) ?? 0) + count)
}

function percentile(histogram: Histogram, fraction: 0.5 | 0.95): number | null {
  const count = [...histogram.values()].reduce((sum, n) => sum + n, 0)
  if (!count) return null
  // Average the two middle observations for a median. Use the upper rank for p95 so at
  // least 95% of the measured values are at or below the value we report.
  const position = fraction === 0.5 ? (count - 1) / 2 : Math.ceil(count * fraction) - 1
  let end = 0
  let lower: number | undefined
  for (const [value, n] of [...histogram].sort(([a], [b]) => a - b)) {
    end += n
    if (end > Math.floor(position)) lower ??= value
    if (end > Math.ceil(position)) return lower! + (value - lower!) * (position % 1)
  }
  return null
}

export function summarizeCapacity(
  responses: { ms: number | null; count: number }[],
  slowed: boolean,
) {
  const responseTimes: Histogram = new Map()
  const renderTimes: Histogram = new Map()
  const heaps: Histogram = new Map()
  const delays: Histogram = new Map()
  const slots = new Set<number>()
  let captures = 0
  let unsettled = 0
  for (const { ms, count } of responses) record(responseTimes, ms, count)

  return {
    render(row: { data: string; durationMs: number; settled: boolean; status: string }) {
      const data = parseJson(row.data) as CrawlUrlRender['data'] | null
      if (data?.renderSlots !== undefined) slots.add(data.renderSlots)
      if (row.status !== 'rendered' || data?.redirected) return
      record(renderTimes, row.durationMs)
      if (data?.jsHeapBytes) record(heaps, Math.ceil(data.jsHeapBytes / MIB) * MIB)
      if (typeof data?.capture?.afterMs !== 'number') return
      captures++
      if (!row.settled) unsettled++
      record(delays, data.capture.delayMs)
    },
    result() {
      const metrics: CrawlCapacityMetrics = {
        urls: responses.reduce((sum, { count }) => sum + count, 0),
        medianResponseMs: percentile(responseTimes, 0.5),
        renderCount: [...renderTimes.values()].reduce((sum, count) => sum + count, 0),
        medianRenderMs: percentile(renderTimes, 0.5),
        heapP95: percentile(heaps, 0.95),
        captures,
        unsettled,
        delayP95Ms: percentile(delays, 0.95),
        slowed,
      }
      return { metrics, slots: [...slots] }
    },
  }
}
