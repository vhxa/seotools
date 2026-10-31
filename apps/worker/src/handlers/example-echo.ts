import { exampleEchoPayload } from '@seotools/core'
import { PermanentJobError, type JobHandler } from '../types'

/** Demo job: waits `delayMs` and echoes the message back as its result. */
export const exampleEcho: JobHandler = async (job, { signal }) => {
  const parsed = exampleEchoPayload.safeParse(job.payload)
  if (!parsed.success) throw new PermanentJobError(`Invalid payload: ${parsed.error.message}`)
  const { message, delayMs } = parsed.data

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('Worker is shutting down'))
      },
      { once: true },
    )
  })

  return { echoed: message, finishedAt: new Date().toISOString() }
}
