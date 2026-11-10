import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createChannel } from '../src/channel.ts'
import { saveCredentials, type Credentials } from '../src/credentials.ts'
import { CredentialsRejectedError } from '../src/gateway.ts'
import { FakeQQGateway } from './fake-gateway.ts'

const stateDirs: string[] = []
afterEach(() => {
  for (const dir of stateDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const credentials: Credentials = { appId: '102000001', appSecret: 'test-app-secret' }

/**
 * Starts a Channel on an in-memory transport, with the test playing Claude Code.
 * `configured: false` leaves the state directory without credentials.
 */
async function startChannel({ configured = true, gateway = new FakeQQGateway() } = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), 'qq-channel-test-'))
  stateDirs.push(stateDir)
  if (configured) saveCredentials(stateDir, credentials)

  const logged: string[] = []
  const channel = createChannel({ gateway, stateDir, log: line => logged.push(line) })
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
  return { channel, gateway, logged, events, request, initialize }
}

/** Lets the Channel's background work (connecting, pushing events) run. */
const settle = () => Bun.sleep(5)

test('the Channel connects to QQ with the stored credentials and disconnects when it stops', async () => {
  const { channel, gateway, logged } = await startChannel()
  await settle()
  expect(gateway.connectedWith).toEqual(credentials)
  expect(logged).toContain('connected to QQ')

  await channel.stop()
  expect(gateway.connectedWith).toBeUndefined()
})

test('Claude Code can register the server as a Channel', async () => {
  const { initialize } = await startChannel()

  // Claude Code does not register a server that agrees to 2026-07-28 as a Channel.
  const result = await initialize()

  expect(result.capabilities.experimental['claude/channel']).toEqual({})
  expect(result.protocolVersion).toBe('2025-11-25')
})

test('without credentials the Channel stays loaded and tells the session to run the configure skill', async () => {
  const { gateway, logged, events, request, initialize } = await startChannel({ configured: false })
  await initialize()
  await settle()

  expect(gateway.connectAttempts).toBe(0)
  expect(events).toHaveLength(1)
  expect(events[0]!.content).toContain('/qq:configure')
  expect(events[0]!.meta).toEqual({ kind: 'status' })
  expect(logged.join('\n')).toContain('/qq:configure')
  // Still serving: the configure skill needs the plugin loaded.
  expect(await request('ping')).toEqual({})
})

test('when QQ rejects the credentials the Channel says so once and does not try again', async () => {
  const gateway = new FakeQQGateway()
  gateway.failNextConnectWith = new CredentialsRejectedError('QQ rejected the credentials (HTTP 200, code 10004)')
  const { logged, events, request, initialize } = await startChannel({ gateway })
  await initialize()
  await settle()

  expect(gateway.connectAttempts).toBe(1)
  expect(events).toHaveLength(1)
  expect(events[0]!.content).toContain('QQ rejected the credentials (HTTP 200, code 10004)')
  expect(events[0]!.content).toContain('/qq:configure')
  expect(logged.join('\n')).toContain('rejected')
  expect(await request('ping')).toEqual({})
})

test('a status event waits for Claude Code to finish its handshake', async () => {
  const { events, initialize } = await startChannel({ configured: false })
  await settle()
  expect(events).toHaveLength(0)

  await initialize()
  await settle()
  expect(events).toHaveLength(1)
})

test('nothing the Channel logs or pushes contains the AppSecret', async () => {
  const gateway = new FakeQQGateway()
  gateway.failNextConnectWith = new Error(`socket closed while sending ${credentials.appSecret}`)
  const { logged, events, initialize } = await startChannel({ gateway })
  await initialize()
  await settle()

  expect(logged.length).toBeGreaterThan(0)
  expect(JSON.stringify([logged, events])).not.toContain(credentials.appSecret)
})

test('when an established connection is lost for good the Channel tells the session', async () => {
  const { gateway, logged, events, initialize } = await startChannel()
  await initialize()
  await settle()
  expect(events).toHaveLength(0)

  gateway.loseConnection(new Error('Gateway closed (4915): banned'))
  await settle()

  expect(events).toHaveLength(1)
  expect(events[0]!.content).toContain('Gateway closed (4915): banned')
  expect(events[0]!.meta).toEqual({ kind: 'status' })
  expect(logged.join('\n')).toContain('Gateway closed (4915): banned')
})
