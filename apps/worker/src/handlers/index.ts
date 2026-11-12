import { JOB_TYPES } from '@seotools/core'
import type { JobHandler } from '../types'
import { exampleEcho } from './example-echo'

/** Handlers that need nothing else. Register those that do in `index.ts`, keyed by `JOB_TYPES`. */
export const handlers: Record<string, JobHandler> = {
  [JOB_TYPES.exampleEcho]: exampleEcho,
}

export { createBotTestHandler } from './bot-test'
