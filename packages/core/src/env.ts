import { z } from './zod'
import { BUILD_CHANNELS, type BuildInfo } from './version'

/** Treat empty strings (e.g. `FOO=` in a .env file) as "not set". */
function cleanSource(source: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''))
}

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

const int = (def: number, min = 1) => z.coerce.number().int().min(min).default(def)

export const commonEnvSchema = z.object({
  /**
   * For staging copies of a production database: the worker fires no schedules, runs no periodic
   * refreshers or update checks and sends no email. Manual actions from the UI still run.
   */
  SEOTOOLS_PAUSE_AUTOMATION: bool.default(false),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** `file:` (SQLite, default), or `postgres://…`. */
  DATABASE_URL: z.string().min(1).default('file:./data/seotools.db'),
  /** Only needed when the dialect can't be inferred from DATABASE_URL. */
  DATABASE_DIALECT: z.enum(['sqlite', 'pg']).optional(),
  /** Used to sign sessions (better-auth) and, by default, to encrypt stored settings. */
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'must be at least 32 characters (try: openssl rand -base64 32)'),
  /** Overrides BETTER_AUTH_SECRET as the key for encrypted settings (SMTP password, API keys…). */
  SETTINGS_ENCRYPTION_KEY: z.string().min(32).optional(),
})

export const webEnvSchema = commonEnvSchema.extend({
  /** Public URL of the app, used by better-auth for cookies and redirects. */
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
  /** Extra comma-separated origins allowed to call the auth API. */
  TRUSTED_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
})

export const workerEnvSchema = commonEnvSchema.extend({
  WORKER_CONCURRENCY: int(2),
  WORKER_POLL_INTERVAL_MS: int(1000, 50),
  /** A job `running` for longer than this is considered abandoned and re-queued. */
  JOB_LOCK_TIMEOUT_MS: int(5 * 60_000, 1000),
  /** Crawls running in parallel. They have their own slots, so they never starve other jobs. */
  CRAWL_CONCURRENCY: int(2),
  /** Lets the crawler reach loopback and private addresses, to audit sites on an intranet. */
  CRAWLER_ALLOW_PRIVATE_NETWORKS: bool.default(false),
  /** The public URL of the app, for the links of the emails the worker sends. */
  BETTER_AUTH_URL: z.string().url().optional(),
})

export const bootstrapEnvSchema = commonEnvSchema.extend({
  RUN_MIGRATIONS: bool.default(true),
})

/**
 * What the image says about the build it came from (the Dockerfile sets both). They are not
 * settings: nothing an administrator configures. Anything missing or odd means "development",
 * because only the release workflow sets `release`.
 */
export const buildEnvSchema = z.object({
  SEOTOOLS_BUILD_CHANNEL: z.enum(BUILD_CHANNELS).catch('development'),
  SEOTOOLS_BUILD_COMMIT: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/i)
    .optional()
    .catch(undefined),
})

export type CommonEnv = z.infer<typeof commonEnvSchema>
export type WebEnv = z.infer<typeof webEnvSchema>
export type WorkerEnv = z.infer<typeof workerEnvSchema>
export type BootstrapEnv = z.infer<typeof bootstrapEnvSchema>

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`)
    this.name = 'EnvError'
  }
}

function parse<S extends z.ZodType>(schema: S, source: Record<string, string | undefined>) {
  const result = schema.safeParse(cleanSource(source))
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    )
  }
  return result.data as z.infer<S>
}

type Source = Record<string, string | undefined>

export const parseCommonEnv = (source: Source = process.env) => parse(commonEnvSchema, source)
export const parseWebEnv = (source: Source = process.env) => parse(webEnvSchema, source)
export const parseWorkerEnv = (source: Source = process.env) => parse(workerEnvSchema, source)
export const parseBootstrapEnv = (source: Source = process.env) => parse(bootstrapEnvSchema, source)

/** The version comes from the code (`package.json`); the channel and the commit from the image. */
export function readBuildInfo(
  version: string | undefined,
  source: Source = process.env,
): BuildInfo {
  const env = buildEnvSchema.parse(cleanSource(source))
  return {
    version: version ?? 'unknown',
    channel: env.SEOTOOLS_BUILD_CHANNEL,
    commit: env.SEOTOOLS_BUILD_COMMIT?.toLowerCase() ?? null,
  }
}

/** The key used to encrypt secrets stored in the `settings` table. */
export function settingsKeyFrom(
  env: Pick<CommonEnv, 'BETTER_AUTH_SECRET' | 'SETTINGS_ENCRYPTION_KEY'>,
) {
  return env.SETTINGS_ENCRYPTION_KEY ?? env.BETTER_AUTH_SECRET
}
