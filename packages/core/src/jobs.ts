import { z } from 'zod'

export const JOB_STATUSES = ['pending', 'running', 'completed', 'failed'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export interface Job<P = unknown, R = unknown> {
  id: string
  type: string
  payload: P
  status: JobStatus
  attempts: number
  maxAttempts: number
  runAt: Date
  lockedAt: Date | null
  lockedBy: string | null
  lastError: string | null
  result: R | null
  createdAt: Date
  updatedAt: Date
}

export interface EnqueueInput {
  type: string
  payload?: unknown
  runAt?: Date
  maxAttempts?: number
}

/** Registry of job types. Add new ones here, with a payload schema. */
export const JOB_TYPES = {
  exampleEcho: 'example.echo',
  mailSend: 'mail.send',
} as const

export const exampleEchoPayload = z.object({
  message: z.string().max(500).default('hello from seotools'),
  delayMs: z.number().int().min(0).max(60_000).default(1500),
})
export type ExampleEchoPayload = z.infer<typeof exampleEchoPayload>

export const mailSendPayload = z.object({
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  subject: z.string().min(1),
  text: z.string().optional(),
  html: z.string().optional(),
})
export type MailSendPayload = z.infer<typeof mailSendPayload>

/** Delay before retrying a job that failed `attempts` times: 5s, 10s, 20s… capped at 15 min. */
export function retryDelayMs(attempts: number, baseMs = 5_000, maxMs = 15 * 60_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1))
}

/** How often a worker writes its heartbeat, and how long before it is considered gone. */
export const WORKER_HEARTBEAT_INTERVAL_MS = 10_000
export const WORKER_STALE_AFTER_MS = 30_000
