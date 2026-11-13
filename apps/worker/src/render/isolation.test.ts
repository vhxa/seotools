import { describe, expect, it } from 'vitest'
import {
  DEAD_PROXY_ERROR,
  firstUnproven,
  isolationProbeOrigins,
  PROBE_PORTS,
  type ProbeOutcome,
} from './isolation'

describe('isolation probe set', () => {
  it('samples loopback v4/v6, every worker address, canaries, private ranges and names', () => {
    const origins = isolationProbeOrigins({
      localAddress: '172.20.0.3',
      canaries: [
        { address: '172.20.0.3', port: 41000 },
        { address: '::1', port: 41001 },
      ],
      interfaces: ['127.0.0.1', '172.20.0.3', '192.168.65.4', 'fe80::42:acff:fe14:3'],
    })
    expect(origins).toEqual(
      expect.arrayContaining([
        '172.20.0.3:41000',
        '[::1]:41001',
        ...PROBE_PORTS.flatMap((port) => [
          `127.0.0.1:${port}`,
          `[::1]:${port}`,
          `172.20.0.3:${port}`,
          `192.168.65.4:${port}`,
          `[fe80::42:acff:fe14:3]:${port}`,
        ]),
        '10.0.0.1',
        '172.16.0.1',
        '192.168.0.1',
        '100.64.0.1',
        '169.254.169.254',
        '[fd00::1]',
        '1.1.1.1',
        '[2606:4700:4700::1111]',
        'example.com',
        'localhost',
      ]),
    )
    expect(new Set(origins).size).toBe(origins.length)
  })
})

describe('isolation verdict', () => {
  const proxy: ProbeOutcome = { error: DEAD_PROXY_ERROR }
  it('accepts only the dead-proxy error for every probe', () => {
    expect(firstUnproven(new Map([['http://a/', proxy]]))).toBeUndefined()
  })
  it.each([
    [
      'a resolver failure (bypassed, then MAP * ~NOTFOUND)',
      { error: 'net::ERR_NAME_NOT_RESOLVED' },
    ],
    ['a refusal', { error: 'net::ERR_CONNECTION_REFUSED' }],
    ['a reset', { error: 'net::ERR_CONNECTION_RESET' }],
    ['no route', { error: 'net::ERR_ADDRESS_UNREACHABLE' }],
    ['a certificate error', { error: 'net::ERR_CERT_AUTHORITY_INVALID' }],
    ['an abort after a timeout', { error: 'net::ERR_ABORTED' }],
    ['a timeout', { timeout: true }],
    ['no outcome', undefined],
  ] as [string, ProbeOutcome | undefined][])('refuses %s', (_name, outcome) => {
    const unproven = firstUnproven(
      new Map([
        ['http://a/', proxy],
        ['http://b/', outcome],
      ]),
    )
    expect(unproven).toMatchObject({ url: 'http://b/', answered: false })
  })
  it('reports an answer as network access', () => {
    expect(firstUnproven(new Map([['http://a/', { answered: true }]]))).toMatchObject({
      answered: true,
    })
  })
})
