import type { Database } from '@seotools/db'
import { describe, expect, it } from 'vitest'
import { getHealth } from './health'

const now = new Date('2026-01-01T12:00:00Z')
const dbWith =
  (lastSeenAt: Date | null, overrides: Partial<Database> = {}) =>
  async () =>
    ({
      dialect: 'sqlite',
      ping: async () => {},
      heartbeats: {
        latest: async () =>
          lastSeenAt ? { workerId: 'w', startedAt: lastSeenAt, lastSeenAt } : null,
      },
      ...overrides,
    }) as unknown as Database

describe('getHealth', () => {
  it('is ok when the db answers and the worker is fresh', async () => {
    const res = await getHealth(dbWith(new Date(now.getTime() - 5_000)), {
      now,
      build: { version: '1.2.3', channel: 'release' },
    })
    expect(res.httpStatus).toBe(200)
    expect(res.report).toEqual({
      status: 'ok',
      version: '1.2.3',
      channel: 'release',
      db: { ok: true, dialect: 'sqlite' },
      worker: { ok: true, lastSeen: '2026-01-01T11:59:55.000Z' },
    })
  })

  it('is degraded (still 200) when the worker is stale or missing', async () => {
    for (const lastSeen of [new Date(now.getTime() - 120_000), null]) {
      const res = await getHealth(dbWith(lastSeen), { now })
      expect(res.report.status).toBe('degraded')
      expect(res.report.worker.ok).toBe(false)
      expect(res.httpStatus).toBe(200)
    }
  })

  it('returns 503 for a missing worker only when it is required', async () => {
    const res = await getHealth(dbWith(null), { now, requireWorker: true })
    expect(res.httpStatus).toBe(503)
    expect(res.report.status).toBe('degraded')
  })

  it('is down (503) when the database is unreachable', async () => {
    const res = await getHealth(
      dbWith(null, {
        ping: async () => {
          throw new Error('connection refused')
        },
      }),
      { now },
    )
    expect(res.httpStatus).toBe(503)
    expect(res.report.status).toBe('down')
    expect(res.report.db.ok).toBe(false)
  })

  it('is down when the database cannot even be opened, without leaking the error', async () => {
    const res = await getHealth(async () => {
      throw new Error('secret connection string')
    })
    expect(res.httpStatus).toBe(503)
    expect(JSON.stringify(res.report)).not.toContain('secret')
  })
})
