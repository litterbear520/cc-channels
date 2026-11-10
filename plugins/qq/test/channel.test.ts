import { expect, test } from 'bun:test'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createChannel } from '../src/channel.ts'
import { FakeQQGateway } from './fake-gateway.ts'

/** Starts a Channel on an in-memory transport, with the test playing Claude Code. */
async function startChannel() {
  const gateway = new FakeQQGateway()
  const channel = createChannel({ gateway })
  const [claudeCodeSide, channelSide] = InMemoryTransport.createLinkedPair()

  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>()
  claudeCodeSide.onmessage = message => {
    if (!('id' in message)) return
    const waiting = pending.get(Number(message.id))
    if ('result' in message) waiting?.resolve(message.result)
    if ('error' in message) waiting?.reject(new Error(message.error.message))
  }
  let nextId = 1
  /** Sends a raw MCP request, as Claude Code would, and resolves with its result. */
  function request(method: string, params: Record<string, unknown>): Promise<any> {
    const id = nextId++
    const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    void claudeCodeSide.send({ jsonrpc: '2.0', id, method, params })
    return result
  }

  await claudeCodeSide.start()
  await channel.start(channelSide)
  return { channel, gateway, request }
}

test('the Channel connects to QQ when it starts and disconnects when it stops', async () => {
  const { channel, gateway } = await startChannel()
  expect(gateway.connected).toBe(true)

  await channel.stop()
  expect(gateway.connected).toBe(false)
})

test('Claude Code can register the server as a Channel', async () => {
  const { request } = await startChannel()

  // Claude Code asks stdio servers for this revision by default, and does not
  // register a server that agrees to it as a Channel.
  const result = await request('initialize', {
    protocolVersion: '2026-07-28',
    capabilities: {},
    clientInfo: { name: 'claude-code', version: '0.0.0' },
  })

  expect(result.capabilities.experimental['claude/channel']).toEqual({})
  expect(result.protocolVersion).toBe('2025-11-25')
})
