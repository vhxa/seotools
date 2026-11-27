import { describe, expect, it } from 'vitest'
import {
  MIB,
  dockerSize,
  estimateDuration,
  estimateLoad,
  estimateMemory,
  recommendedCapacity,
  type CapacityHardware,
  type CrawlCapacitySample,
} from './capacity'

const server: CapacityHardware = {
  processors: 4,
  memory: 8192 * MIB,
  browserMemory: 3072 * MIB,
  browserShm: 1024 * MIB,
}
const pace = { concurrency: 2, requestsPerSecond: 5 }
const sample: CrawlCapacitySample = {
  pace,
  renderSlots: 4,
  elapsedMs: 200_000,
  metrics: {
    urls: 100,
    medianResponseMs: 200,
    medianRenderMs: 1800,
    renderCount: 100,
    heapP95: 64 * MIB,
    captures: 100,
    unsettled: 10,
    delayP95Ms: 200,
    slowed: true,
  },
}
const settings = { ...pace, maxUrls: null }

describe('capacity recommendations', () => {
  it('reserves server memory and fits four render slots and two crawls on the 8 GiB server', () => {
    expect(recommendedCapacity(server)).toEqual({ renders: 4, crawls: 2 })
  })
  it('recommends one slot on a 2 GiB Pi with four processors', () => {
    expect(
      recommendedCapacity({ ...server, memory: 2048 * MIB, browserMemory: 1536 * MIB }),
    ).toEqual({ renders: 1, crawls: 1 })
  })
  it('uses the server budget when the browser ceiling is unknown and floors tiny servers at one', () => {
    expect(recommendedCapacity({ ...server, browserMemory: null }).renders).toBe(4)
    expect(recommendedCapacity({ ...server, browserMemory: null, memory: MIB })).toEqual({
      renders: 1,
      crawls: 1,
    })
    expect(recommendedCapacity({ ...server, browserMemory: 1536 * MIB }).renders).toBe(2)
  })
  it.each([
    ['3g', 3072 * MIB],
    ['1536m', 1536 * MIB],
    ['256MB', 256 * MIB],
    ['1GiB', 1024 * MIB],
    ['4k', 4096],
    ['123b', 123],
    ['123', 123],
    [undefined, null],
    ['0', null],
    ['-4m', null],
    ['wat', null],
    ['1.5g', 1536 * MIB],
    ['9007199254740992', null],
  ])('parses Docker size %s', (value, bytes) => {
    expect(dockerSize(value)).toBe(bytes)
  })
})

describe('capacity estimates', () => {
  it('cannot estimate duration without a crawl or the historical render limit', () => {
    expect(estimateDuration(null, 'html', settings, 4)).toBeNull()
    expect(estimateDuration({ ...sample, metrics: null }, 'html', settings, 4)).toBeNull()
    expect(estimateDuration({ ...sample, renderSlots: null }, 'rendered', settings, 4)).toBeNull()
  })
  it('calibrates the HTML model and respects the rate and URL limit', () => {
    expect(estimateDuration(sample, 'html', settings, 4)).toBe(200_000)
    expect(estimateDuration(sample, 'html', { ...settings, requestsPerSecond: 10 }, 4)).toBe(
      100_000,
    )
    expect(estimateDuration(sample, 'html', { ...settings, maxUrls: 50 }, 4)).toBe(100_000)
  })
  it('calibrates rendered duration and caps effective parallelism at domain requests', () => {
    expect(estimateDuration(sample, 'rendered', settings, 8)).toBe(200_000)
    expect(estimateDuration(sample, 'rendered', { ...settings, concurrency: 4 }, 4)).toBe(100_000)
    expect(estimateDuration(sample, 'rendered', { ...settings, concurrency: 4 }, 1)).toBe(360_000)
    expect(estimateLoad(settings, 'rendered', 8)).toEqual({
      documents: 2,
      renders: 2,
      resources: 12,
      requestsPerSecond: 5,
    })
    expect(estimateLoad(settings, 'html', 8)).toMatchObject({ renders: 0, resources: 0 })
  })
  it('separates browser, processor and server risk and uses observed heaps when available', () => {
    expect(estimateMemory(4, server, null)).toMatchObject({
      browser: 2368 * MIB,
      ceiling: 3072 * MIB,
      budget: 6144 * MIB,
      browserRisk: false,
      processorRisk: false,
      serverRisk: false,
      measuredHeap: false,
    })
    expect(estimateMemory(8, server, null)).toMatchObject({
      browserRisk: true,
      processorRisk: true,
      serverRisk: false,
    })
    expect(estimateMemory(8, server, 512 * MIB)).toMatchObject({
      serverRisk: true,
      measuredHeap: true,
    })
    expect(estimateMemory(4, null, null)).toMatchObject({ ceiling: null, budget: null })
  })
})
