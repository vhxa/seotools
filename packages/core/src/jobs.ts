import { z } from './zod'

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
  crawlRun: 'crawl.run',
  /** Analyses a domain's latest full crawl again with its current audit configuration. */
  auditRecompute: 'audit.recompute',
  /** Requests some URLs of a domain again and checks what each one answers on its own. */
  urlVerify: 'url.verify',
  botTest: 'bot.test',
  /** Sends someone a link to set their password. The link is made when sending, never stored. */
  accessEmail: 'access.email',
  /** Tells the people who asked for it that a full crawl ended, if there is something to act on. */
  crawlAlerts: 'crawl.alerts',
  cwvCollect: 'cwv.collect',
  incidentAlerts: 'incident.alerts',
  vitalsAlerts: 'vitals.alerts',
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

export const crawlRunPayload = z.object({ crawlId: z.string().min(1) })
export type CrawlRunPayload = z.infer<typeof crawlRunPayload>

export const auditRecomputePayload = z.object({ domainId: z.string().min(1) })
export type AuditRecomputePayload = z.infer<typeof auditRecomputePayload>

export const urlVerifyPayload = z.object({ verificationId: z.string().min(1) })
export type UrlVerifyPayload = z.infer<typeof urlVerifyPayload>

/** Delay before retrying a job that failed `attempts` times: 5s, 10s, 20s… capped at 15 min. */
export function retryDelayMs(attempts: number, baseMs = 5_000, maxMs = 15 * 60_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1))
}

/** How often a worker writes its heartbeat, and how long before it is considered gone. */
export const WORKER_HEARTBEAT_INTERVAL_MS = 10_000
export const WORKER_STALE_AFTER_MS = 30_000

export const accessEmailPayload = z.object({
  userId: z.string().min(1),
  kind: z.enum(['invite', 'reset']),
  locale: z.enum(['en', 'es']),
})
export type AccessEmailPayload = z.infer<typeof accessEmailPayload>

export const crawlAlertsPayload = z.object({ crawlId: z.string().min(1) })
export type CrawlAlertsPayload = z.infer<typeof crawlAlertsPayload>

export const cwvCollectPayload = z.object({ crawlId: z.string().min(1) })

export type CwvCollectPayload = z.infer<typeof cwvCollectPayload>

export const botTestPayload = z.object({ runId: z.string().min(1) })
export const incidentAlertsPayload = z.object({
  incidentId: z.string().min(1),
  stage: z.enum(['open', 'changed', 'warn-14', 'warn-3', 'expired', 'resolved']),
})
export const vitalsAlertsPayload = z.object({ crawlId: z.string().min(1) })
