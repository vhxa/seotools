import {
  boolean,
  datetime,
  index,
  int,
  longtext,
  mysqlTable,
  text,
  varchar,
} from 'drizzle-orm/mysql-core'

const ts = (name: string) => datetime(name, { mode: 'date', fsp: 3 })
const id = (name: string) => varchar(name, { length: 36 })
const now = () => new Date()

// --- better-auth ---------------------------------------------------------
export const user = mysqlTable('user', {
  id: id('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: ts('created_at').notNull().$defaultFn(now),
  updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
})

export const session = mysqlTable(
  'session',
  {
    id: id('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: varchar('token', { length: 255 }).notNull().unique(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
    ipAddress: varchar('ip_address', { length: 255 }),
    userAgent: text('user_agent'),
    userId: id('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
)

export const account = mysqlTable(
  'account',
  {
    id: id('id').primaryKey(),
    accountId: varchar('account_id', { length: 255 }).notNull(),
    providerId: varchar('provider_id', { length: 255 }).notNull(),
    userId: id('user_id')
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

export const verification = mysqlTable(
  'verification',
  {
    id: id('id').primaryKey(),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)

// --- app -----------------------------------------------------------------
export const jobs = mysqlTable(
  'jobs',
  {
    id: id('id').primaryKey(),
    type: varchar('type', { length: 191 }).notNull(),
    payload: longtext('payload').notNull(),
    status: varchar('status', { length: 16, enum: ['pending', 'running', 'completed', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull().default(3),
    runAt: ts('run_at').notNull().$defaultFn(now),
    lockedAt: ts('locked_at'),
    lockedBy: varchar('locked_by', { length: 191 }),
    lastError: text('last_error'),
    result: longtext('result'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now),
  },
  (t) => [
    index('jobs_claim_idx').on(t.status, t.runAt, t.createdAt),
    index('jobs_created_idx').on(t.createdAt),
  ],
)

export const workerHeartbeats = mysqlTable('worker_heartbeats', {
  workerId: varchar('worker_id', { length: 191 }).primaryKey(),
  startedAt: ts('started_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull(),
})

export const settings = mysqlTable('settings', {
  key: varchar('key', { length: 191 }).primaryKey(),
  value: longtext('value').notNull(),
  encrypted: boolean('encrypted').notNull().default(false),
  updatedAt: ts('updated_at').notNull().$defaultFn(now),
})

export const companies = mysqlTable('companies', {
  id: id('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: ts('created_at').notNull().$defaultFn(now),
})

export const domains = mysqlTable(
  'domains',
  {
    id: id('id').primaryKey(),
    companyId: id('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** Normalized by `normalizeDomain` in @seotools/core: `example.com`, never a URL. */
    host: varchar('host', { length: 253 }).notNull().unique(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('domains_company_id_idx').on(t.companyId)],
)
