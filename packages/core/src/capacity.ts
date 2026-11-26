import { z } from './zod'

export const MIB = 1024 ** 2
const BROWSER_BASE = 320 * MIB
const RENDERER_BASE = 160 * MIB
const DEFAULT_RENDER_MEMORY = 512 * MIB
const APP_RESERVE = 512 * MIB
export const RESOURCES_PER_RENDER = 6

export const capacityLimits = { renders: { min: 1, max: 8 }, crawls: { min: 1, max: 4 } }
export const capacitySchema = z.object({
  renders: z.number().int().min(capacityLimits.renders.min).max(capacityLimits.renders.max),
  crawls: z.number().int().min(capacityLimits.crawls.min).max(capacityLimits.crawls.max),
})
export type Capacity = z.infer<typeof capacitySchema>
export const capacityHardwareSchema = z.object({
  processors: z.number().int().positive(),
  memory: z.number().int().positive(),
  browserMemory: z.number().int().positive().nullable(),
  browserShm: z.number().int().positive().nullable(),
})
export type CapacityHardware = z.infer<typeof capacityHardwareSchema>
export const minimumCapacity: Capacity = { renders: 1, crawls: 1 }

export function dockerSize(value?: string): number | null {
  const match = /^(\d+)\s*(b|[kmg]b?)?$/i.exec(value?.trim() ?? '')
  if (!match) return null
  const power = ['', 'k', 'm', 'g'].indexOf(match[2]?.[0]?.toLowerCase() ?? '')
  const bytes = Number(match[1]) * 1024 ** Math.max(0, power)
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null
}

export const serverBudget = (memory: number) => Math.floor(memory * 0.75)

export function recommendedCapacity(hardware: CapacityHardware): Capacity {
  const budget = serverBudget(hardware.memory)
  const browserBudget = Math.min(budget - APP_RESERVE, hardware.browserMemory ?? Infinity)
  return {
    renders: Math.max(
      1,
      Math.min(
        capacityLimits.renders.max,
        hardware.processors,
        Math.floor((browserBudget - BROWSER_BASE) / DEFAULT_RENDER_MEMORY),
      ),
    ),
    crawls: Math.max(
      1,
      Math.min(
        capacityLimits.crawls.max,
        Math.floor(hardware.processors / 2),
        Math.floor(budget / (1536 * MIB)),
      ),
    ),
  }
}

export function estimateMemory(
  renders: number,
  hardware: CapacityHardware | null,
  heapP95: number | null,
) {
  // V8 heap omits native allocations. Allow another heap's worth alongside the renderer baseline.
  const perRender = heapP95 === null ? DEFAULT_RENDER_MEMORY : RENDERER_BASE + 2 * heapP95
  const browser = BROWSER_BASE + renders * perRender
  const ceiling = hardware?.browserMemory ?? null
  const budget = hardware ? serverBudget(hardware.memory) : null
  return {
    browser,
    ceiling,
    budget,
    measuredHeap: heapP95 !== null,
    browserRisk: ceiling !== null && browser > 0.85 * ceiling,
    serverRisk: budget !== null && browser + APP_RESERVE > budget,
    processorRisk: hardware !== null && renders > hardware.processors,
  }
}

export function estimateLoad(settings: Pace, mode: 'html' | 'rendered', renderSlots: number) {
  const renders = mode === 'rendered' ? Math.min(settings.concurrency, renderSlots) : 0
  return {
    documents: settings.concurrency,
    renders,
    resources: renders * RESOURCES_PER_RENDER,
    requestsPerSecond: settings.requestsPerSecond,
  }
}

type Pace = { concurrency: number; requestsPerSecond: number }

export interface CrawlCapacityMetrics {
  urls: number
  medianResponseMs: number | null
  renderCount: number
  medianRenderMs: number | null
  heapP95: number | null
  captures: number
  unsettled: number
  delayP95Ms: number | null
  slowed: boolean
}

export interface CrawlCapacitySample {
  metrics: CrawlCapacityMetrics
  elapsedMs: number
  pace: Pace | null
  renderSlots: number | null
}

export function estimateDuration(
  sample: CrawlCapacitySample | null,
  mode: 'html' | 'rendered',
  settings: Pace & { maxUrls: number | null },
  renderSlots: number,
): number | null {
  if (!sample?.pace || !sample.metrics.urls || !sample.elapsedMs) return null
  const { metrics, pace } = sample
  if (metrics.medianResponseMs === null) return null
  if (
    mode === 'rendered' &&
    (sample.renderSlots === null || metrics.medianRenderMs === null || metrics.renderCount === 0)
  )
    return null
  const response = metrics.medianResponseMs
  const render = metrics.medianRenderMs ?? 0
  const model = (urls: number, pace: Pace, slots: number) => {
    const renderWork =
      mode === 'rendered' ? urls * (metrics.renderCount / metrics.urls) * render : 0
    return Math.max(
      (urls / pace.requestsPerSecond) * 1000,
      (urls * response + renderWork) / pace.concurrency,
      renderWork / Math.min(slots, pace.concurrency),
    )
  }
  const before = model(metrics.urls, pace, sample.renderSlots ?? 1)
  const after = model(Math.min(metrics.urls, settings.maxUrls ?? Infinity), settings, renderSlots)
  return (sample.elapsedMs * after) / before
}

export const CAPACITY_KEY = 'worker.capacity'
export const CAPACITY_HARDWARE_KEY = 'worker.capacityHardware'
export const CAPACITY_UPGRADE_KEY = 'worker.capacityUpgrade.v090'
export const CAPACITY_DISMISSED_KEY = 'worker.capacityUpgrade.dismissed.v090'
