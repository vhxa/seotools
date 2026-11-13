import { spawnSync, execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { createLogger, DEFAULT_CRAWL_SETTINGS } from '@seotools/core'
import { createRenderService } from './service'
import { createRenderResourceCache } from './cache'
import { createRequester } from '../crawl/requester'

const docker = existsSync('/Applications/Docker.app/Contents/Resources/bin/docker')
  ? '/Applications/Docker.app/Contents/Resources/bin/docker'
  : 'docker'
const image = 'chromedp/headless-shell:158.0.8127.18'
const available = spawnSync(docker, ['image', 'inspect', image], { timeout: 10_000 }).status === 0
const exec = promisify(execFile)
const run = async (...args: string[]) =>
  (await exec(docker, args, { timeout: 30_000 })).stdout.trim()
const compose = readFileSync(new URL('../../../../docker-compose.yml', import.meta.url), 'utf8')
const memory = compose.match(/mem_limit: (\S+)/)![1]!
const pids = compose.match(/pids_limit: (\d+)/)![1]!
const entrypoint = compose.match(/ {6}- \|\n([\s\S]*?) {6}- --\n/)![1]!.replaceAll('$$', '$')
const flags = [...compose.matchAll(/^ {6}- (--.*)$/gm)]
  .map((match) => match[1]!)
  .filter((flag) => flag !== '--')

// Real pinned image, shipped hardening/limits; a test bridge publishes CDP to the host. No pulling or app startup.
// Skipped when Docker or the browser image is unavailable. Also records all supported sizes.
it.skipIf(!available)(
  'fits four polling renders plus a check within shipped process/memory limits',
  async () => {
    const name = `wp3-budget-${process.pid}`
    await run('network', 'create', name)
    try {
      for (const concurrency of [1, 2, 3, 4]) {
        const container = `${name}-${concurrency}`
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
          '256m',
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
            .poll(
              async () =>
                await run('port', container, '9222/tcp').catch(async (error: unknown) => {
                  console.log(await run('logs', container))
                  throw error
                }),
              { timeout: 5000 },
            )
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
          const loaded = new Set<string>()
          const requester = createRequester({
            fetcher: {
              close() {},
              async fetch(url) {
                loaded.add(new URL(url).searchParams.get('page') ?? '')
                return {
                  statusCode: 200,
                  headers: {},
                  body: Buffer.from('ok'),
                  bytes: 2,
                  truncated: false,
                  responseTimeMs: 0,
                }
              },
            },
            settings: { ...DEFAULT_CRAWL_SETTINGS, requestsPerSecond: 1000, maxRetries: 0 },
            signal,
            log: createLogger('budget-test', 'silent'),
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
          try {
            const body = Buffer.from(
              '<main>polling</main><script>setInterval(()=>fetch("/poll?page="+location.pathname+"&t="+Date.now()),30)</script>',
            )
            const renders = Promise.all(
              Array.from({ length: concurrency }, (_, n) =>
                service!.render({
                  url: `http://site.test/${n}`,
                  host: 'site.test',
                  userAgent: 'budget-test',
                  signal,
                  requester,
                  cache: createRenderResourceCache(),
                  allowedByRobots: () => true,
                  waitMs: 6000,
                  document: {
                    statusCode: 200,
                    headers: { 'content-type': 'text/html' },
                    body,
                    bytes: body.length,
                    truncated: false,
                    responseTimeMs: 0,
                  },
                }),
              ),
            )
            await expect
              .poll(() => loaded.size, { timeout: 10_000 })
              .toBeGreaterThanOrEqual(concurrency)
            const check = service.check()
            expect((await renders).map((outcome) => outcome.status)).toEqual(
              Array(concurrency).fill('rendered'),
            )
            expect((await check).state).toBe('ready')
          } finally {
            sampling = false
            await sampler
          }
          const events = await run(
            'exec',
            container,
            'cat',
            '/sys/fs/cgroup/pids.events',
            '/sys/fs/cgroup/memory.events',
          )
          expect(events).toMatch(/^max 0\n/)
          expect(events.split('\n').every((line) => line.endsWith(' 0'))).toBe(true)
          console.log(
            'BROWSER_BUDGET',
            JSON.stringify({ concurrency, peakPids, peakRssKiB, peakCgroupBytes, events }),
          )
        } finally {
          await service?.close()
          await run('rm', '-f', container)
        }
      }
    } finally {
      await run('network', 'rm', name)
    }
  },
  180_000,
)
