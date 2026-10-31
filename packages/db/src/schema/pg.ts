import { boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

const ts = (name: string) => timestamp(name, { mode: 'date', withTimezone: true })
const now = () => new Date()

// --- better-auth ---------------------------------------------------------
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: ts('created_at').notNull().$defaultFn(now),
  updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)

// --- app -----------------------------------------------------------------
export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    payload: text('payload').notNull().default('{}'),
    status: text('status', { enum: ['pending', 'running', 'completed', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAt: ts('run_at').notNull().$defaultFn(now),
    lockedAt: ts('locked_at'),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    result: text('result'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now),
  },
  (t) => [
    index('jobs_claim_idx').on(t.status, t.runAt, t.createdAt),
    index('jobs_created_idx').on(t.createdAt),
  ],
)

export const workerHeartbeats = pgTable('worker_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  startedAt: ts('started_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull(),
})

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  encrypted: boolean('encrypted').notNull().default(false),
  updatedAt: ts('updated_at').notNull().$defaultFn(now),
})
