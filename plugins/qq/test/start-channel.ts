import { afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createChannel } from '../src/channel.ts'
import { saveCredentials, type Credentials } from '../src/credentials.ts'
import { FakeQQGateway } from './fake-gateway.ts'

const stateDirs: string[] = []
const stopAfterTest: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const stop of stopAfterTest.splice(0)) await stop().catch(() => {})
  for (const dir of stateDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

export const credentials: Credentials = { appId: '102000001', appSecret: 'test-app-secret' }

/**
 * Starts a Channel on an in-memory transport, with the test playing Claude Code.
 * `configured: false` leaves the state directory without credentials.
 */
export async function startChannel({
  configured = true,
  gateway = new FakeQQGateway(),
  pairingCodes = [] as string[],
} = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), 'qq-channel-test-'))
  stateDirs.push(stateDir)
  if (configured) saveCredentials(stateDir, credentials)

  const logged: string[] = []
  /** The Channel's clock. Tests move it by assigning to `now`. */
  const clock = { now: Date.UTC(2026, 10, 11, 9, 0, 0) }
  const channel = createChannel({
    gateway,
    stateDir,
    log: line => logged.push(line),
    now: () => clock.now,
    // Codes are handed out in the order given; without any, the Channel makes its own.
    ...(pairingCodes.length > 0 ? { newPairingCode: () => pairingCodes.shift() ?? 'ffffff' } : {}),
    approvalPollMs: 2,
  })
  stopAfterTest.push(() => channel.stop())
  const [claudeCodeSide, channelSide] = InMemoryTransport.createLinkedPair()

  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>()
  /** Channel events pushed into the session, in order. */
  const events: { content: string; meta?: Record<string, string> }[] = []
  claudeCodeSide.onmessage = message => {
    if ('method' in message && message.method === 'notifications/claude/channel') {
      events.push(message.params as (typeof events)[number])
    }
    if (!('id' in message)) return
    const waiting = pending.get(Number(message.id))
    if ('result' in message) waiting?.resolve(message.result)
    if ('error' in message) waiting?.reject(new Error(message.error.message))
  }
  let nextId = 1
  /** Sends a raw MCP request, as Claude Code would, and resolves with its result. */
  function request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = nextId++
    const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    void claudeCodeSide.send({ jsonrpc: '2.0', id, method, params })
    return result
  }
  /** Completes the MCP handshake. Claude Code asks stdio servers for 2026-07-28 by default. */
  async function initialize(): Promise<any> {
    const result = await request('initialize', {
      protocolVersion: '2026-07-28',
      capabilities: {},
      clientInfo: { name: 'claude-code', version: '0.0.0' },
    })
    await claudeCodeSide.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    return result
  }

  await claudeCodeSide.start()
  await channel.start(channelSide)
  return { channel, gateway, stateDir, clock, logged, events, request, initialize }
}

/** Lets the Channel's background work (connecting, pushing events) run. */
export const settle = () => Bun.sleep(15)

