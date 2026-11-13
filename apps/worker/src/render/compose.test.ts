import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps shared memory and every non-intercepted transport restriction in the browser service', () => {
  const compose = readFileSync(new URL('../../../../docker-compose.yml', import.meta.url), 'utf8')
  const browser = compose.split('\n  browser:\n')[1]?.split('\nvolumes:')[0] ?? ''
  expect(browser).toContain('shm_size: 256m')
  expect(browser).toContain('mem_limit: 512m')
  for (const flag of [
    '--proxy-server=http://127.0.0.1:9',
    '--proxy-bypass-list=<-loopback>',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  ])
    expect(browser).toContain(flag)
})
