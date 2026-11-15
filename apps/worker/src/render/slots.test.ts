import { expect, it } from 'vitest'
import { createSlots, untilAborted } from './slots'

it('never has more holders than its limit, serves waiters in order and lets aborted ones go', async () => {
  const slots = createSlots(2)
  const order: number[] = []
  let peak = 0
  const hold = async (id: number, signal = new AbortController().signal) => {
    await slots.acquire(signal)
    peak = Math.max(peak, slots.active)
    order.push(id)
    await new Promise((resolve) => setTimeout(resolve, 10))
    slots.release()
  }
  // Two hold, the rest wait; the aborted waiter leaves the line without taking a slot.
  const first = [hold(1), hold(2)]
  const gone = new AbortController()
  const abandoned = hold(99, gone.signal)
  const all = Promise.all([...first, hold(3), hold(4)])
  gone.abort()
  await expect(abandoned).rejects.toThrow()
  await all
  expect(peak).toBe(2)
  expect(order).toEqual([1, 2, 3, 4])
  expect(slots.active).toBe(0)
  expect(slots.waiting).toBe(0)
  expect(() => createSlots(0)).toThrow()
})

it('stops waiting when its signal aborts, while the work itself goes on', async () => {
  const stop = new AbortController()
  let finished = false
  const work = new Promise<string>((resolve) =>
    setTimeout(() => {
      finished = true
      resolve('done')
    }, 30),
  )
  const waiting = untilAborted(work, stop.signal)
  stop.abort()
  await expect(waiting).rejects.toThrow()
  expect(await work).toBe('done')
  expect(finished).toBe(true)
  await expect(untilAborted(Promise.resolve(1), new AbortController().signal)).resolves.toBe(1)
})
