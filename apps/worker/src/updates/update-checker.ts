import {
  checkForUpdates,
  loadUpdateConfig,
  loadUpdateState,
  periodicCheckDue,
  type Logger,
  type Settings,
} from '@seotools/core'

export interface UpdateChecker {
  /** Looks for a new release if the administrator asked for periodic checks and one is due. */
  tick(): Promise<void>
  /** Waits for a check in flight, so the database can be closed. */
  stop(): Promise<void>
}

/**
 * The periodic half of looking for updates. Nothing depends on its outcome and a missed pass is
 * made up for by the next, so it is not a job of the queue; a check that fails is stored as such
 * (`checkForUpdates`) and retried sooner than a good one. Off until an administrator turns it on.
 */
export function createUpdateChecker(options: {
  settings: Settings
  log: Logger
  fetch?: typeof fetch
  now?: () => Date
}): UpdateChecker {
  const { settings, log } = options
  const now = options.now ?? (() => new Date())
  let stopping = false
  let running: Promise<void> | null = null

  async function pass() {
    const [config, state] = await Promise.all([
      loadUpdateConfig(settings),
      loadUpdateState(settings),
    ])
    if (stopping || !periodicCheckDue(config, state, now())) return

    const result = await checkForUpdates(settings, {
      trigger: 'periodic',
      now: now(),
      fetch: options.fetch,
    })
    log.info(
      { failure: result.attempt?.failure ?? null, latest: result.latest?.version ?? null },
      'checked for updates',
    )
  }

  return {
    tick() {
      if (stopping) return Promise.resolve()
      running ??= pass()
        .catch((error) => log.error({ err: error }, 'checking for updates failed'))
        .finally(() => {
          running = null
        })
      return running
    },
    async stop() {
      stopping = true
      await running
    },
  }
}
