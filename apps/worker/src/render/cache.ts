import { FetchError, type FetchedResponse } from '../crawl/fetcher'
import { RENDER_LIMITS } from './limits'

export type ResourceAnswer = FetchedResponse | FetchError

/** One instance per crawl, never shared between credentials or domains. */
export function createRenderResourceCache(maxBytes: number = RENDER_LIMITS.cacheBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid render cache size')
  const entries = new Map<string, { answer: ResourceAnswer; bytes: number }>()
  const pending = new Map<string, Promise<ResourceAnswer>>()
  let bytes = 0
  return {
    get bytes() {
      return bytes
    },
    async request(url: string, method: string, type: string, load: () => Promise<ResourceAnswer>) {
      const eligible = method === 'GET' && (type === 'script' || type === 'stylesheet')
      if (!eligible) return { answer: await load(), cached: false }
      const entry = entries.get(url)
      if (entry) {
        entries.delete(url)
        entries.set(url, entry)
        return { answer: entry.answer, cached: true }
      }
      const inflight = pending.get(url)
      if (inflight) return { answer: await inflight, cached: true }
      const promise = load()
      pending.set(url, promise)
      try {
        const answer = await promise
        const size =
          Buffer.byteLength(url) +
          (answer instanceof FetchError
            ? Buffer.byteLength(answer.code + answer.message) + 64
            : (answer.body?.length ?? 0) + Buffer.byteLength(JSON.stringify(answer.headers)) + 128)
        if (size <= maxBytes && !(answer instanceof FetchError && answer.code === 'BODY_LIMIT')) {
          while (bytes + size > maxBytes) {
            const first = entries.entries().next().value
            if (!first) break
            entries.delete(first[0])
            bytes -= first[1].bytes
          }
          entries.set(url, { answer, bytes: size })
          bytes += size
        }
        return { answer, cached: false }
      } finally {
        pending.delete(url)
      }
    },
  }
}
export type RenderResourceCache = ReturnType<typeof createRenderResourceCache>
