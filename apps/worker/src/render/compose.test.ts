import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps shared memory and every non-intercepted transport restriction in the browser service', () => {
  const compose = readFileSync(new URL('../../../../docker-compose.yml', import.meta.url), 'utf8')
  const browser = compose.split('\n  browser:\n')[1]?.split('\nvolumes:')[0] ?? ''
  expect(browser).toContain('shm_size: 256m')
  expect(browser).toContain('mem_limit: 768m')
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
