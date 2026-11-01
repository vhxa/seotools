import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { CREDENTIAL_PROVIDER, EMPTY_COUNTS, groupDomains, toJob, truncateError } from '../mapping'
import * as schema from '../schema/pg'
import type { Database } from '../types'

const { jobs, workerHeartbeats, settings, user, account, companies, domains } = schema

export function createPgDatabase(options: {
  url: string
  defaultMigrationsDir: () => string
}): Database {
  const client = postgres(options.url, { max: 10, onnotice: () => {} })
  const db = drizzle(client, { schema })

  return {
    dialect: 'pg',
    orm: {
      db,
      schema: { user, session: schema.session, account, verification: schema.verification },
    },

    async ping() {
      await db.execute(sql`select 1`)
    },

    async migrate(dir) {
      await migrate(db, { migrationsFolder: dir ?? options.defaultMigrationsDir() })
    },

    async close() {
      await client.end({ timeout: 5 })
    },

    jobs: {
      async enqueue(input) {
        const now = new Date()
        const [row] = await db
          .insert(jobs)
          .values({
            id: randomUUID(),
            type: input.type,
            payload: JSON.stringify(input.payload ?? {}),
            runAt: input.runAt ?? now,
            ...(input.maxAttempts ? { maxAttempts: input.maxAttempts } : {}),
            createdAt: now,
            updatedAt: now,
          })
          .returning()
        return toJob(row!)
      },

      async get(id) {
        const [row] = await db.select().from(jobs).where(eq(jobs.id, id))
        return row ? toJob(row) : null
      },

      async list({ limit = 20, status } = {}) {
        const rows = await db
          .select()
          .from(jobs)
          .where(status ? eq(jobs.status, status) : undefined)
          .orderBy(desc(jobs.createdAt))
          .limit(limit)
        return rows.map(toJob)
      },

      async countByStatus() {
        const rows = await db
          .select({ status: jobs.status, count: sql<number>`count(*)` })
          .from(jobs)
          .groupBy(jobs.status)
        const counts = { ...EMPTY_COUNTS }
        for (const r of rows) counts[r.status] = Number(r.count)
        return counts
      },

      async claim({ workerId, limit, now = new Date() }) {
        // FOR UPDATE SKIP LOCKED: concurrent workers each get a disjoint set of rows.
        const claimed = await db.transaction(async (tx) => {
          const due = await tx
            .select()
            .from(jobs)
            .where(and(eq(jobs.status, 'pending'), lte(jobs.runAt, now)))
            .orderBy(asc(jobs.runAt), asc(jobs.createdAt))
            .limit(limit)
            .for('update', { skipLocked: true })
          const out = []
          for (const row of due) {
            const patch = {
              status: 'running' as const,
              attempts: row.attempts + 1,
              lockedAt: now,
              lockedBy: workerId,
              updatedAt: now,
            }
            await tx.update(jobs).set(patch).where(eq(jobs.id, row.id))
            out.push({ ...row, ...patch })
          }
          return out
        })
        return claimed.map(toJob)
      },

      async complete({ id, workerId, result }) {
        await db
          .update(jobs)
          .set({
            status: 'completed',
            result: result === undefined ? null : JSON.stringify(result),
            lastError: null,
            lockedAt: null,
            lockedBy: null,
            updatedAt: new Date(),
          })
          .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
      },

      async fail({ id, workerId, error, retryAt }) {
        await db
          .update(jobs)
          .set({
            status: retryAt ? 'pending' : 'failed',
            ...(retryAt ? { runAt: retryAt } : {}),
            lastError: truncateError(error),
            lockedAt: null,
            lockedBy: null,
            updatedAt: new Date(),
          })
          .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
      },

      async requeueStale({ lockedBefore }) {
        const now = new Date()
        const stale = and(eq(jobs.status, 'running'), lt(jobs.lockedAt, lockedBefore))
        const reset = {
          lockedAt: null,
          lockedBy: null,
          lastError: 'Worker lock expired',
          updatedAt: now,
        }
        return db.transaction(async (tx) => {
          const failed = await tx
            .update(jobs)
            .set({ ...reset, status: 'failed' })
            .where(and(stale, gte(jobs.attempts, jobs.maxAttempts)))
            .returning({ id: jobs.id })
          const requeued = await tx
            .update(jobs)
            .set({ ...reset, status: 'pending', runAt: now })
            .where(stale)
            .returning({ id: jobs.id })
          return failed.length + requeued.length
        })
      },
    },

    heartbeats: {
      async beat({ workerId, startedAt, now = new Date() }) {
        await db
          .insert(workerHeartbeats)
          .values({ workerId, startedAt, lastSeenAt: now })
          .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { lastSeenAt: now } })
        await db
          .delete(workerHeartbeats)
          .where(lt(workerHeartbeats.lastSeenAt, new Date(now.getTime() - 24 * 3600_000)))
      },
      async latest() {
        const [row] = await db
          .select()
          .from(workerHeartbeats)
          .orderBy(desc(workerHeartbeats.lastSeenAt))
          .limit(1)
        return row ?? null
      },
    },

    settings: {
      async get(key) {
        const [row] = await db.select().from(settings).where(eq(settings.key, key))
        return row ? { value: row.value, encrypted: row.encrypted } : null
      },
      async set(key, value, encrypted) {
        const updatedAt = new Date()
        await db
          .insert(settings)
          .values({ key, value, encrypted, updatedAt })
          .onConflictDoUpdate({ target: settings.key, set: { value, encrypted, updatedAt } })
      },
      async delete(key) {
        await db.delete(settings).where(eq(settings.key, key))
      },
    },

    admin: {
      async findByEmail(email) {
        const [found] = await db.select().from(user).where(eq(user.email, email))
        if (!found) return null
        const [cred] = await db
          .select({ password: account.password })
          .from(account)
          .where(and(eq(account.userId, found.id), eq(account.providerId, CREDENTIAL_PROVIDER)))
        return { id: found.id, email: found.email, passwordHash: cred?.password ?? null }
      },
      async create({ id, email, name, passwordHash }) {
        await db.transaction(async (tx) => {
          await tx.insert(user).values({ id, email, name, emailVerified: true })
          await tx.insert(account).values({
            id: randomUUID(),
            accountId: id,
            providerId: CREDENTIAL_PROVIDER,
            userId: id,
            password: passwordHash,
          })
        })
      },
      async exists() {
        const rows = await db.select({ id: user.id }).from(user).limit(1)
        return rows.length > 0
      },
    },

    companies: {
      async list() {
        // Domains first: every domain read has its company, so the second read can't miss one.
        const domainRows = await db.select().from(domains)
        const companyRows = await db.select().from(companies)
        return groupDomains(companyRows, domainRows)
      },
      async get(id) {
        const [row] = await db.select().from(companies).where(eq(companies.id, id))
        return row ?? null
      },
      async create({ name, host }) {
        const now = new Date()
        const company = { id: randomUUID(), name, createdAt: now }
        const domain = { id: randomUUID(), companyId: company.id, host, createdAt: now }
        await db.transaction(async (tx) => {
          await tx.insert(companies).values(company)
          await tx.insert(domains).values(domain)
        })
        return { company, domain }
      },
    },

    domains: {
      async findByHost(host) {
        const [row] = await db
          .select({ domain: domains, company: companies })
          .from(domains)
          .innerJoin(companies, eq(domains.companyId, companies.id))
          .where(eq(domains.host, host))
        return row ? { ...row.domain, company: row.company } : null
      },
      async add({ companyId, host }) {
        const domain = { id: randomUUID(), companyId, host, createdAt: new Date() }
        await db.insert(domains).values(domain)
        return domain
      },
    },
  }
}
