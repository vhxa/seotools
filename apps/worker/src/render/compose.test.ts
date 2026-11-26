import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps shared memory and every non-intercepted transport restriction in the browser service', () => {
  const compose = readFileSync(new URL('../../../../docker-compose.yml', import.meta.url), 'utf8')
  const browser = compose.split('\n  browser:\n')[1]?.split('\nvolumes:')[0] ?? ''
  // Overridable from .env, with the shipped defaults.
  expect(browser).toContain('shm_size: ${RENDER_BROWSER_SHM:-1g}')
  expect(browser).toContain('pids_limit: 256')
  expect(browser).toContain('mem_limit: ${RENDER_BROWSER_MEMORY:-3g}')
  for (const flag of [
    'user:',
    'init: true',
    'read_only: true',
    'cap_drop: [ALL]',
    'no-new-privileges',
  ])
    expect(browser).toContain(flag)
  for (const flag of [
    '--proxy-server=http://127.0.0.1:9',
    '--proxy-bypass-list=<-loopback>',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  ])
    expect(browser).toContain(flag)
})

it('forwards resolver rules as one literal argument through the Compose shell entrypoint', () => {
  const compose = readFileSync(new URL('../../../../docker-compose.yml', import.meta.url), 'utf8')
  const script = compose.match(/ {6}- \|\n([\s\S]*?) {6}- --\n/)?.[1]
  expect(script).toBeDefined()
  // Compose consumes $$ before invoking bash. Capture exec argv without starting Chrome/socat.
  const capture = `exec() { if [[ "$1" == /headless-shell/headless-shell ]]; then printf '%s\\0' "$@"; fi; }
`
  const rule = '--host-resolver-rules=MAP * ~NOTFOUND'
  const result = spawnSync(
    '/bin/bash',
    ['-c', capture + script!.replaceAll('$$', '$'), '--', rule],
    { encoding: 'utf8' },
  )
  expect(result.status).toBe(0)
  expect(result.stdout.split('\0').filter(Boolean)).toEqual([
    '/headless-shell/headless-shell',
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--remote-debugging-address=0.0.0.0',
    '--remote-debugging-port=9223',
    rule,
  ])
})

it('deploys the same browser on Dokploy, with no published port, build or database override', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const root = read('../../../../docker-compose.yml')
  const dokploy = read('../../../../deploy/dokploy/docker-compose.yml')
  const browserOf = (compose: string) =>
    compose.split('\n  browser:\n')[1]?.split('\nvolumes:')[0]?.trim() ?? ''
  expect(browserOf(dokploy)).not.toBe('')
  expect(browserOf(dokploy)).toBe(browserOf(root))
  const app = dokploy.split('\n  seotools:\n')[1]?.split('\n  browser:\n')[0] ?? ''
  for (const compose of [root, dokploy]) {
    const service = compose.split('\n  seotools:\n')[1]?.split('\n  browser:')[0] ?? ''
    expect(service).toContain('RENDER_BROWSER_MEMORY: ${RENDER_BROWSER_MEMORY:-3g}')
    expect(service).toContain('RENDER_BROWSER_SHM: ${RENDER_BROWSER_SHM:-1g}')
  }
  expect(app).toContain('pull_policy: always')
  expect(app).toContain('networks: [dokploy-network, render]')
  for (const forbidden of ['ports:', 'build:', 'DATABASE_URL']) expect(app).not.toContain(forbidden)
  expect(dokploy).toMatch(/\n {2}render:\n {4}internal: true\n/)
})
