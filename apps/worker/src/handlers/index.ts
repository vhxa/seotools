import { JOB_TYPES } from '@seotools/core'
import type { JobHandler } from '../types'
import { exampleEcho } from './example-echo'
import { mailSend } from './mail-send'

/** Register new job handlers here, keyed by their type in `JOB_TYPES`. */
export const handlers: Record<string, JobHandler> = {
  [JOB_TYPES.exampleEcho]: exampleEcho,
  [JOB_TYPES.mailSend]: mailSend,
}
