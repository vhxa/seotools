import type { EnqueueInput, Job, JobStatus, SettingsStore } from '@seotools/core'

export type Dialect = 'sqlite' | 'pg' | 'mysql'

export interface ListJobsOptions {
  limit?: number
  status?: JobStatus
}

export interface JobRepository {
  enqueue(input: EnqueueInput): Promise<Job>
  get(id: string): Promise<Job | null>
  list(options?: ListJobsOptions): Promise<Job[]>
  countByStatus(): Promise<Record<JobStatus, number>>
  /** Atomically moves up to `limit` due jobs to `running` for this worker (attempts += 1). */
  claim(input: { workerId: string; limit: number; now?: Date }): Promise<Job[]>
  complete(input: { id: string; workerId: string; result?: unknown }): Promise<void>
  /** With `retryAt` the job goes back to `pending`; without it, it's marked `failed`. */
  fail(input: { id: string; workerId: string; error: string; retryAt?: Date }): Promise<void>
  /** Recovers jobs whose worker died: back to `pending`, or `failed` if out of attempts. */
  requeueStale(input: { lockedBefore: Date }): Promise<number>
}

export interface Heartbeat {
  workerId: string
  startedAt: Date
  lastSeenAt: Date
}

export interface HeartbeatRepository {
  beat(input: { workerId: string; startedAt: Date; now?: Date }): Promise<void>
  latest(): Promise<Heartbeat | null>
}

export interface AdminAccount {
  id: string
  email: string
  /** Hash of the credential account, if there is one. */
  passwordHash: string | null
}

export interface AdminRepository {
  /** Whether any user exists. While none does, the app offers the first-run setup. */
  exists(): Promise<boolean>
  findByEmail(email: string): Promise<AdminAccount | null>
  /** Creates the user and its credential account together. Rejects if the id or email is taken. */
  create(input: { id: string; email: string; name: string; passwordHash: string }): Promise<void>
}

export interface Database {
  readonly dialect: Dialect
  readonly jobs: JobRepository
  readonly heartbeats: HeartbeatRepository
  readonly settings: SettingsStore
  readonly admin: AdminRepository
  /** Drizzle instance and auth tables, for better-auth's drizzle adapter. */
  readonly orm: { db: unknown; schema: Record<string, unknown> }
  /** Rejects if the database is unreachable. */
  ping(): Promise<void>
  /** Applies pending migrations from `migrationsDir` (default: the bundled ones). */
  migrate(migrationsDir?: string): Promise<void>
  close(): Promise<void>
}
