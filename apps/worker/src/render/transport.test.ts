import { Resolver } from 'node:dns/promises'
import { createSocket } from 'node:dgram'
import { createServer } from 'node:http'
import { expect, it } from 'vitest'
import { connectBrowser } from './transport'

it('cancels a never-answering DNS resolver within the connection deadline', async () => {
  const dns = createSocket('udp4')
  await new Promise<void>((resolve) => dns.bind(0, '127.0.0.1', resolve))
  const resolver = new Resolver({ timeout: 10000, tries: 5 })
  resolver.setServers([`127.0.0.1:${dns.address().port}`])
  let cancelled = false
  const cancel = resolver.cancel.bind(resolver)
  resolver.cancel = () => {
    cancelled = true
    cancel()
  }
  try {
    const started = Date.now()
    await expect(
      connectBrowser('http://unanswered.test:9222', {
        timeoutMs: 100,
        createResolver: () => resolver,
      }),
    ).rejects.toThrow('timed out')
    expect(Date.now() - started).toBeLessThan(1000)
    expect(cancelled).toBe(true)
  } finally {
    dns.close()
  }
})

it.each(['discovery', 'handshake'])('cancels never-answering %s sockets', async (stage) => {
  const sockets = new Set<import('node:net').Socket>()
  const server = createServer((_request, response) => {
    if (stage === 'handshake')
      response.end(
        JSON.stringify({
          webSocketDebuggerUrl: `ws://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/devtools`,
        }),
      )
  })
  server.on('upgrade', (_request, socket) => { socket.resume(); socket.on('end', () => socket.end()) })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as import('node:net').AddressInfo
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
