import type { Socket, AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { expect, it } from 'vitest'
import { browserIdentity, connectBrowser } from './transport'

it('stops waiting for a never-answering system lookup at the connection deadline', async () => {
  let late: ((answers: { address: string; family: number }[]) => void) | undefined
  const started = Date.now()
  await expect(
    connectBrowser('http://unanswered.test:9222', {
      timeoutMs: 100,
      lookup: () => new Promise((resolve) => (late = resolve)),
    }),
  ).rejects.toThrow('timed out')
  expect(Date.now() - started).toBeLessThan(1000)
  // getaddrinfo cannot be cancelled; a late answer is ignored and connects nowhere.
  late?.([{ address: '127.0.0.1', family: 4 }])
})

it('uses the system resolver (hosts file) and tries each address in order', async () => {
  const hits: string[] = []
  const server = createServer((request, response) => {
    hits.push(request.headers.host ?? '')
    response.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    const looked: string[] = []
    // ::1 has nothing on this port: the IPv4 address that follows must still be reached.
    await expect(
      connectBrowser(`http://browser.test:${port}`, {
        timeoutMs: 2000,
        lookup: async (hostname) => {
          looked.push(hostname)
          return [
            { address: '::1', family: 6 },
            { address: '127.0.0.1', family: 4 },
          ]
        },
      }),
    ).rejects.toThrow('Invalid discovery response')
    expect(looked).toEqual(['browser.test'])
    expect(hits).toEqual([`127.0.0.1:${port}`])
    // Without an injected lookup, `localhost` goes through getaddrinfo, which reads /etc/hosts.
    await expect(connectBrowser(`http://localhost:${port}`, { timeoutMs: 2000 })).rejects.toThrow(
      'Invalid discovery response',
    )
    expect(hits).toEqual([`127.0.0.1:${port}`, `127.0.0.1:${port}`])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

it('reads the browser instance GUID from the WebSocket URL it upgrades with', () => {
  expect(
    browserIdentity('ws://10.0.0.2:9222/devtools/browser/FE700822-E437-4D32-BA88-346FF7B39755'),
  ).toEqual({ identity: 'fe700822-e437-4d32-ba88-346ff7b39755' })
  expect(browserIdentity('ws://10.0.0.2:9222/devtools/page/x')).toEqual({})
})

it.each(['discovery', 'handshake'])('cancels never-answering %s sockets', async (stage) => {
  const sockets = new Set<Socket>()
  const server = createServer((_request, response) => {
    if (stage === 'handshake')
      response.end(
        JSON.stringify({
          webSocketDebuggerUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/devtools`,
        }),
      )
  })
  server.on('upgrade', (_request, socket) => {
    socket.resume()
    socket.on('end', () => socket.end())
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as AddressInfo
    const started = Date.now()
    await expect(
      connectBrowser(`http://127.0.0.1:${address.port}`, { timeoutMs: 100 }),
    ).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(Date.now() - started).toBeLessThan(1000)
    expect(sockets.size).toBe(0)
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
