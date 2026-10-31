import { describe, expect, it } from 'vitest'
import { EnvError, parseBootstrapEnv, parseWebEnv, parseWorkerEnv, settingsKeyFrom } from './env'

const secret = 's'.repeat(32)

describe('env', () => {
  it('applies defaults', () => {
    const env = parseWebEnv({ BETTER_AUTH_SECRET: secret })
    expect(env).toMatchObject({
      DATABASE_URL: 'file:./data/seotools.db',
      BETTER_AUTH_URL: 'http://localhost:3000',
      LOG_LEVEL: 'info',
      TRUSTED_ORIGINS: [],
    })
  })

  it('treats empty strings as unset', () => {
    const env = parseWorkerEnv({
      BETTER_AUTH_SECRET: secret,
      DATABASE_URL: '',
      DATABASE_DIALECT: '',
      WORKER_CONCURRENCY: '',
    })
    expect(env.DATABASE_URL).toBe('file:./data/seotools.db')
    expect(env.DATABASE_DIALECT).toBeUndefined()
    expect(env.WORKER_CONCURRENCY).toBe(2)
  })

  it('coerces numbers and parses lists and booleans', () => {
    expect(
      parseWorkerEnv({ BETTER_AUTH_SECRET: secret, WORKER_CONCURRENCY: '5' }).WORKER_CONCURRENCY,
    ).toBe(5)
    expect(
      parseWebEnv({
        BETTER_AUTH_SECRET: secret,
        TRUSTED_ORIGINS: 'https://a.test, https://b.test,',
      }).TRUSTED_ORIGINS,
    ).toEqual(['https://a.test', 'https://b.test'])
    const boot = { BETTER_AUTH_SECRET: secret }
    expect(parseBootstrapEnv(boot).RUN_MIGRATIONS).toBe(true)
    expect(parseBootstrapEnv({ ...boot, RUN_MIGRATIONS: 'false' }).RUN_MIGRATIONS).toBe(false)
  })

  it('lists every problem at once', () => {
    const error = (() => {
      try {
        parseBootstrapEnv({ BETTER_AUTH_SECRET: 'short', RUN_MIGRATIONS: 'maybe' })
      } catch (e) {
        return e as EnvError
      }
    })()
    expect(error).toBeInstanceOf(EnvError)
    expect(error!.issues.map((i) => i.split(':')[0]).sort()).toEqual([
      'BETTER_AUTH_SECRET',
      'RUN_MIGRATIONS',
    ])
  })

  it('never takes admin credentials from the environment', () => {
    const env = parseBootstrapEnv({
      BETTER_AUTH_SECRET: secret,
      ADMIN_EMAIL: 'admin@example.com',
      ADMIN_PASSWORD: 'long-enough-1',
    })
    expect(env).not.toHaveProperty('ADMIN_EMAIL')
    expect(env).not.toHaveProperty('ADMIN_PASSWORD')
  })

  it('rejects an unknown dialect', () => {
    expect(() => parseWebEnv({ BETTER_AUTH_SECRET: secret, DATABASE_DIALECT: 'mongo' })).toThrow(
      EnvError,
    )
  })

  it('uses SETTINGS_ENCRYPTION_KEY when given, else the auth secret', () => {
    expect(settingsKeyFrom({ BETTER_AUTH_SECRET: secret })).toBe(secret)
    expect(
      settingsKeyFrom({ BETTER_AUTH_SECRET: secret, SETTINGS_ENCRYPTION_KEY: 'k'.repeat(32) }),
    ).toBe('k'.repeat(32))
  })
})
