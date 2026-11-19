import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { approvePairing } from '../src/access.ts'
import { createChannel } from '../src/channel.ts'
import { saveCredentials, type Credentials } from '../src/credentials.ts'
import type { InboundMessage } from '../src/gateway.ts'
import { removeAfterTest, stopAfterTest } from './cleanup.ts'
import { FakeQQGateway } from './fake-gateway.ts'

export const credentials: Credentials = { appId: '102000001', appSecret: 'test-app-secret' }

/**
 * Starts a Channel on an in-memory transport, with the test playing Claude Code.
 * `configured: false` leaves the state directory without credentials. Passing
 * the `stateDir` of an earlier Channel starts it again, as after a restart.
 */
export async function startChannel({
  configured = true,
  gateway = new FakeQQGateway(),
  pairingCodes = [] as string[],
  stateDir = undefined as string | undefined,
  receivedLogPruneMs = 60_000,
} = {}) {
  if (stateDir === undefined) {
    stateDir = mkdtempSync(join(tmpdir(), 'qq-channel-test-'))
    removeAfterTest(stateDir)
    if (configured) saveCredentials(stateDir, credentials)
  }

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
    listeningDelayMs: 1,
    receivedLogPruneMs,
  })
  stopAfterTest(() => channel.stop())
  const [claudeCodeSide, channelSide] = InMemoryTransport.createLinkedPair()

  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>()
  /** Channel events pushed into the session, in order. */
  const events: { content: string; meta?: Record<string, string> }[] = []
  /** Channel events that arrived before Claude Code was listening for them, and were lost. */
  const dropped: (typeof events)[number][] = []
  /** Answers to permission prompts the Channel passed on, in order. */
  const verdicts: { request_id: string; behavior: string }[] = []
  // Claude Code registers its handler for Channel events only once it has the server's list of tools.
  let listening = false
  claudeCodeSide.onmessage = message => {
    if ('method' in message && message.method === 'notifications/claude/channel') {
      ;(listening ? events : dropped).push(message.params as (typeof events)[number])
    }
    if ('method' in message && message.method === 'notifications/claude/channel/permission') {
      verdicts.push(message.params as (typeof verdicts)[number])
    }
    if (!('id' in message)) return
    const waiting = pending.get(Number(message.id))
    if ('result' in message && 'tools' in message.result) listening = true
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
  /**
   * Completes the MCP handshake and lists the tools, as Claude Code does before it listens for
   * Channel events. Claude Code asks stdio servers for 2026-07-28 by default.
   */
  async function initialize({ listTools = true } = {}): Promise<any> {
    const result = await request('initialize', {
      protocolVersion: '2026-07-28',
      capabilities: {},
      clientInfo: { name: 'claude-code', version: '0.0.0' },
    })
    await claudeCodeSide.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    if (listTools) await request('tools/list')
    return result
  }

  /** Asks the Channel to relay a permission prompt, as Claude Code does when a tool call needs approval. */
  async function askPermission(request: {
    request_id: string
    tool_name: string
    description: string
    input_preview: string
  }): Promise<void> {
    await claudeCodeSide.send({
      jsonrpc: '2.0',
      method: 'notifications/claude/channel/permission_request',
      params: request,
    })
  }

  /** Calls one of the Channel's tools, as Claude would. Resolves with the text it returned. */
  async function callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const result = await request('tools/call', { name, arguments: args })
    return { text: result.content.map((part: { text: string }) => part.text).join('\n'), isError: result.isError === true }
  }

  await claudeCodeSide.start()
  await channel.start(channelSide)
  return { channel, gateway, stateDir, clock, logged, events, dropped, verdicts, request, initialize, callTool, askPermission }
}

/** Lets the Channel's background work (connecting, pushing events) run. */
export const settle = () => Bun.sleep(15)


let messageCount = 0
/** A Direct chat message from the given Sender, with an ID of its own. */
export function messageFrom(senderId: string, text = '你好'): InboundMessage {
  messageCount++
  return { messageId: `msg-${messageCount}`, senderId, text, timestamp: '2026-11-11T09:00:00+08:00', attachments: [] }
}

/** A message the given Sender wrote in a Group chat, mentioning the bot unless told otherwise. */
export function groupMessageFrom(senderId: string, groupId: string, text = '你好', mentionsBot = true): InboundMessage {
  return { ...messageFrom(senderId, text), senderName: `name of ${senderId}`, group: { id: groupId, mentionsBot } }
}

/** Starts a connected Channel whose session has finished its handshake. */
export async function startConnected(options: Parameters<typeof startChannel>[0] = {}) {
  const started = await startChannel(options)
  await started.initialize()
  await settle()
  return started
}

/** Starts a Channel with one Sender already paired. */
export async function startWithPairedSender(senderId: string) {
  const started = await startConnected({ pairingCodes: ['a1b2c3'] })
  started.gateway.receive(messageFrom(senderId))
  await settle()
  approvePairing(started.stateDir, 'a1b2c3', started.clock.now)
  await settle()
  started.gateway.sent.length = 0
  started.gateway.attempts.length = 0
  return started
}
