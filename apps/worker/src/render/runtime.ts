import { JOB_TYPES, RENDER_STATUS_KEY, renderCheckPayload, type Settings } from '@seotools/core'
import type { JobHandler } from '../types'
import type { RenderService } from './service'
import { RENDER_LIMITS } from './limits'
import { createRenderStatusWriter } from './status-writer'

/** Unconfigured workers never load Puppeteer or the rendering engine. */
export async function startRenderRuntime(options: {
  browserUrl?: string
  concurrency: number
  settings: Settings
  paused: boolean
  onError: (error: unknown) => void
}) {
  const writeStatus = createRenderStatusWriter(options.settings)
  let service: RenderService | undefined
  if (options.browserUrl) {
    const { createRenderService } = await import('./service')
    service = createRenderService({
      browserUrl: options.browserUrl,
      concurrency: options.concurrency,
      writeStatus,
    })
  }
  const check = () =>
    service
      ? service.check()
      : writeStatus({ state: 'not-configured', checkedAt: new Date().toISOString() })
  await check()
  const timer =
    service && !options.paused
      ? setInterval(() => {
          void check().catch(options.onError)
        }, RENDER_LIMITS.checkIntervalMs)
      : undefined
  const handler: JobHandler = async (job) => {
    renderCheckPayload.parse(job.payload)
    await check()
  }
  return {
    handlers: { [JOB_TYPES.renderCheck]: handler },
    service,
    async stop() {
      if (timer) clearInterval(timer)
      await service?.close()
      // A stopped worker cannot claim the browser is still connected.
      await options.settings.delete(RENDER_STATUS_KEY)
    },
  }
}
