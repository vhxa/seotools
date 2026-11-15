/**
 * At most `limit` holders at a time, served in order. A waiter whose signal aborts leaves the line
 * without taking a slot, so a finished page never holds one up.
 */
export function createSlots(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid slot limit')
  let active = 0
  const waiting: (() => void)[] = []
  return {
    get active() {
      return active
    },
    get waiting() {
      return waiting.length
    },
    async acquire(signal: AbortSignal) {
      signal.throwIfAborted()
      if (active < limit) {
        active++
        return
      }
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          signal.removeEventListener('abort', cancel)
          resolve()
        }
        const cancel = () => {
          const index = waiting.indexOf(ready)
          if (index >= 0) waiting.splice(index, 1)
          reject(new DOMException('Stopped', 'AbortError'))
        }
        waiting.push(ready)
        signal.addEventListener('abort', cancel, { once: true })
      })
    },
    /** Hands the slot to the next waiter, who then holds it: `active` does not change. */
    release() {
      const next = waiting.shift()
      if (next) next()
      else active--
    },
  }
}
export type Slots = ReturnType<typeof createSlots>

/** Waits for `promise`, but no longer than `signal` allows. The promise itself keeps running. */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {})
    return Promise.reject(new DOMException('Stopped', 'AbortError'))
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Stopped', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}
