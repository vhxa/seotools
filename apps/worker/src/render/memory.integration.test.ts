import { spawnSync, execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { createLogger } from '@seotools/core'
import { nuxtSite } from '../crawl/nuxt-site'
import { createRequester } from '../crawl/requester'
import { SITE } from '../crawl/test-site'
import { createRenderResourceCache } from './cache'
import { RENDER_LIMITS } from './limits'
import { createRenderService } from './service'
import { createSlots } from './slots'

const docker = existsSync('/Applications/Docker.app/Contents/Resources/bin/docker')
  ? '/Applications/Docker.app/Contents/Resources/bin/docker'
  : 'docker'
const image = 'chromedp/headless-shell:158.0.8127.18'
const available =
  !!process.env.RENDER_BENCH &&
  spawnSync(docker, ['image', 'inspect', image], { timeout: 10_000 }).status === 0
const exec = promisify(execFile)
const run = async (...args: string[]) =>
  (await exec(docker, args, { timeout: 30_000 })).stdout.trim()
const compose = readFileSync(new URL('../../../../docker-compose.yml', import.meta.url), 'utf8')
const defaults = {
  memory: compose.match(/mem_limit: \$\{RENDER_BROWSER_MEMORY:-(\S+)\}/)![1]!,
  shm: compose.match(/shm_size: \$\{RENDER_BROWSER_SHM:-(\S+)\}/)![1]!,
}
const pids = compose.match(/pids_limit: (\d+)/)![1]!
const entrypoint = compose.match(/ {6}- \|\n([\s\S]*?) {6}- --\n/)![1]!.replaceAll('$$', '$')
const flags = [...compose.matchAll(/^ {6}- (--.*)$/gm)]
  .map((match) => match[1]!)
  .filter((flag) => flag !== '--')

/**
 * Memory and processes of the shipped browser container rendering the heavy Nuxt-like pages (about
 * 75 scripts and stylesheets each, a request that never ends, a 5 s window) at each concurrency.
 * Measures, for docs/rendering.md; runs only on request (`RENDER_BENCH=1`) with Docker and the
 * pinned image: `pnpm exec vitest run apps/worker/src/render/memory.integration.test.ts --silent=false`.
 */
it.skipIf(!available)(
  'measures the browser rendering heavy pages at 1, 2 and 4 at a time',
  async () => {
    const name = `wp8-memory-${process.pid}`
    await run('network', 'create', name)
    try {
      for (const [concurrency, memory, shm] of [
        [1, defaults.memory, defaults.shm],
        [2, defaults.memory, defaults.shm],
        [4, defaults.memory, defaults.shm],
        [4, '3g', '1g'],
      ] as const) {
        const container = `${name}-${concurrency}-${memory}`
        await run(
          'run',
          '-d',
          '--name',
          container,
          '--network',
          name,
          '--publish',
          '127.0.0.1::9222',
          '--user',
          '65534:65534',
          '--init',
          '--read-only',
          '--tmpfs',
          '/tmp',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges:true',
          '--shm-size',
          shm,
          '--memory',
          memory,
          '--pids-limit',
          pids,
          '--entrypoint',
          '/bin/bash',
          image,
          '-c',
          entrypoint,
          '--',
          ...flags,
        )
        let service: ReturnType<typeof createRenderService> | undefined
        try {
          await expect
            .poll(async () => await run('port', container, '9222/tcp'), { timeout: 5000 })
            .toBeTruthy()
          const port = (await run('port', container, '9222/tcp')).split(':').at(-1)
          service = createRenderService({
            browserUrl: `http://127.0.0.1:${port}`,
            concurrency,
            writeStatus: async () => {},
          })
          await expect
            .poll(async () => (await service!.check()).state, { timeout: 30_000 })
            .toBe('ready')
          const signal = new AbortController().signal
          const site = nuxtSite({ pages: concurrency * 3 })
          const fetcher = site.createFetcher({
            userAgent: 'memory-test',
            timeoutMs: 30_000,
            concurrency: 2,
          })
          const requester = createRequester({
            fetcher,
            settings: { requestsPerSecond: 5, maxRetries: 0 },
            signal,
            log: createLogger('memory-test', 'silent'),
            retryBaseMs: 1,
          })
          let sampling = true
          let peakPids = 0,
            peakRssKiB = 0,
            peakCgroupBytes = 0
          const sample = async () => {
            while (sampling) {
              const values = (
                await run(
                  'exec',
                  container,
                  '/bin/bash',
                  '-c',
                  `cat /sys/fs/cgroup/pids.current /sys/fs/cgroup/memory.current; total=0; for f in /proc/[0-9]*/status; do while read -r key value rest; do if [[ "$key" == VmRSS: ]]; then total=$((total+value)); fi; done < "$f" 2>/dev/null; done; echo "$total"`,
                )
              )
                .split('\n')
                .map(Number)
              peakPids = Math.max(peakPids, values[0]!)
              peakCgroupBytes = Math.max(peakCgroupBytes, values[1]!)
              peakRssKiB = Math.max(peakRssKiB, values[2]!)
            }
          }
          const sampler = sample()
          const cache = createRenderResourceCache()
          const resourceSlots = createSlots(RENDER_LIMITS.pageResources * concurrency)
          const started = Date.now()
          let outcomes
          try {
            outcomes = await Promise.all(
              site.paths
                .filter((path) => path !== '/js-only')
                .map(async (path) => {
                  const document = await requester.fetchWithRetries(`${SITE}${path}`, {
                    readBody: 'force',
                  })
                  if (document instanceof Error) throw document
                  return service!.render({
                    url: `${SITE}${path}`,
                    host: 'example.com',
                    userAgent: 'memory-test',
                    signal,
                    requester,
                    cache,
                    resourceSlots,
                    allowedByRobots: () => true,
                    waitMs: 5000,
                    document,
                  })
                }),
            )
          } finally {
            sampling = false
            await sampler
          }
          const seconds = (Date.now() - started) / 1000
          const events = await run(
            'exec',
            container,
            'cat',
            '/sys/fs/cgroup/pids.events',
            '/sys/fs/cgroup/memory.events',
          )
          console.log(
            'BROWSER_MEMORY',
            JSON.stringify({
              concurrency,
              memory,
              shm,
              pages: outcomes.length,
              seconds,
              statuses: outcomes.map((outcome) => outcome.status),
              peakPids,
              peakRssMiB: Math.round(peakRssKiB / 1024),
              peakCgroupMiB: Math.round(peakCgroupBytes / 1024 / 1024),
              events: events.replaceAll('\n', ' '),
            }),
          )
          expect(outcomes.every((outcome) => outcome.status === 'rendered')).toBe(true)
        } finally {
          await service?.close()
          await run('rm', '-f', container)
        }
      }
    } finally {
      await run('network', 'rm', name)
    }
  },
  1_800_000,
)
