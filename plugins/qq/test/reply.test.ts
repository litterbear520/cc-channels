import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { messageFrom, settle, startChannel, startConnected, startWithPairedSender } from './start-channel.ts'

const MINUTE_MS = 60 * 1000

/** Starts a Channel whose paired Sender has just written one message. */
async function startWithMessageFrom(senderId: string) {
  const started = await startWithPairedSender(senderId)
  const inbound = messageFrom(senderId, 'how is the build?')
  started.gateway.receive(inbound)
  await settle()
  return { ...started, inbound }
}

test('reply answers the Sender\'s latest message with a Markdown Passive reply and returns its ID', async () => {
  const { gateway, callTool, inbound } = await startWithMessageFrom('SENDER1')

  const result = await callTool('reply', { chat_id: 'SENDER1', text: 'The build is **green**.' })

  expect(result.isError).toBe(false)
  expect(result.text).toContain('sent-1')
  expect(gateway.sent).toHaveLength(1)
  expect(gateway.sent[0]!.senderId).toBe('SENDER1')
  expect(gateway.sent[0]!.content).toEqual({ type: 'markdown', text: 'The build is **green**.' })
  expect(gateway.sent[0]!.answering).toEqual({ messageId: inbound.messageId, sequence: 1 })
})

test('each Passive reply to the same message carries the next sequence number', async () => {
  const { gateway, callTool } = await startWithMessageFrom('SENDER1')

  await callTool('reply', { chat_id: 'SENDER1', text: 'one' })
  await callTool('reply', { chat_id: 'SENDER1', text: 'two' })
  await callTool('reply', { chat_id: 'SENDER1', text: 'three' })

  expect(gateway.sent.map(message => message.answering?.sequence)).toEqual([1, 2, 3])
})

test('a newer inbound message becomes the one that is answered', async () => {
  const { gateway, callTool } = await startWithMessageFrom('SENDER1')
  await callTool('reply', { chat_id: 'SENDER1', text: 'one' })

  const newer = messageFrom('SENDER1', 'and the deploy?')
  gateway.receive(newer)
  await settle()
  await callTool('reply', { chat_id: 'SENDER1', text: 'two' })

  expect(gateway.sent[1]!.answering).toEqual({ messageId: newer.messageId, sequence: 1 })
})

test('once four Passive replies have answered a message, the next goes out as a Proactive message', async () => {
  const { gateway, callTool } = await startWithMessageFrom('SENDER1')

  for (const text of ['one', 'two', 'three', 'four', 'five']) {
    await callTool('reply', { chat_id: 'SENDER1', text })
  }

  expect(gateway.sent.map(message => message.answering?.sequence)).toEqual([1, 2, 3, 4, undefined])
  expect(gateway.sent[4]!.content).toEqual({ type: 'markdown', text: 'five' })
})

test('an hour after the Sender\'s message, the reply goes out as a Proactive message', async () => {
  const { gateway, callTool, clock } = await startWithMessageFrom('SENDER1')

  clock.now += 59 * MINUTE_MS
  await callTool('reply', { chat_id: 'SENDER1', text: 'still in time' })
  clock.now += MINUTE_MS
  await callTool('reply', { chat_id: 'SENDER1', text: 'too late' })

  expect(gateway.sent[0]!.answering).toBeDefined()
  expect(gateway.sent[1]!.answering).toBeUndefined()
})

test('a Sender whose last message the Channel does not remember gets a Proactive message', async () => {
  const { gateway, callTool, stateDir } = await startConnected()
  // Paired in an earlier session; nothing has arrived from them in this one.
  writeFileSync(join(stateDir, 'access.json'), JSON.stringify({ policy: 'pairing', allowFrom: ['SENDER1'], pending: {} }))

  const result = await callTool('reply', { chat_id: 'SENDER1', text: 'the nightly run finished' })

  expect(result.isError).toBe(false)
  expect(gateway.sent).toHaveLength(1)
  expect(gateway.sent[0]!.answering).toBeUndefined()
})

test('a Markdown message QQ rejects is sent once more as plain text, in the same mode', async () => {
  const { gateway, callTool, inbound } = await startWithMessageFrom('SENDER1')
  gateway.refuse = attempt => (attempt.content.type === 'markdown' ? new Error('markdown not allowed') : undefined)

  const result = await callTool('reply', { chat_id: 'SENDER1', text: 'The build is **green**.' })

  expect(result.isError).toBe(false)
  expect(gateway.attempts).toHaveLength(2)
  expect(gateway.sent).toHaveLength(1)
  expect(gateway.sent[0]!.content).toEqual({ type: 'text', text: 'The build is **green**.' })
  // A new sequence number: QQ refuses a reused one.
  expect(gateway.sent[0]!.answering).toEqual({ messageId: inbound.messageId, sequence: 2 })
})

test('a Passive reply QQ rejects in both forms falls back to a plain-text Proactive message', async () => {
  const { gateway, callTool } = await startWithMessageFrom('SENDER1')
  gateway.refuse = attempt => (attempt.answering ? new Error('passive reply window closed') : undefined)

  const result = await callTool('reply', { chat_id: 'SENDER1', text: 'done' })

  expect(result.isError).toBe(false)
  expect(gateway.attempts.map(attempt => [attempt.content.type, attempt.answering?.sequence])).toEqual([
    ['markdown', 1],
    ['text', 2],
    ['text', undefined],
  ])
  expect(gateway.sent).toHaveLength(1)
})

test('a Proactive message is also tried as Markdown first and then as plain text', async () => {
  const { gateway, callTool, clock } = await startWithMessageFrom('SENDER1')
  clock.now += 61 * MINUTE_MS
  gateway.refuse = attempt => (attempt.content.type === 'markdown' ? new Error('markdown not allowed') : undefined)

  await callTool('reply', { chat_id: 'SENDER1', text: 'done' })

  expect(gateway.attempts.map(attempt => [attempt.content.type, attempt.answering])).toEqual([
    ['markdown', undefined],
    ['text', undefined],
  ])
  expect(gateway.sent).toHaveLength(1)
})

test('when the Proactive message fails too, reply returns an error naming the cause and sends nothing later', async () => {
  const { gateway, callTool } = await startWithMessageFrom('SENDER1')
  gateway.refuse = attempt =>
    new Error(attempt.answering ? 'passive reply window closed' : 'the user has switched proactive messages off')

  const result = await callTool('reply', { chat_id: 'SENDER1', text: 'done' })

  expect(result.isError).toBe(true)
  expect(result.text).toContain('the user has switched proactive messages off')
  expect(result.text).toContain('passive reply window closed')
  expect(gateway.attempts).toHaveLength(3)

  gateway.refuse = () => undefined
  await settle()
  expect(gateway.sent).toHaveLength(0)
  expect(gateway.attempts).toHaveLength(3)
})

test('text over 2000 characters is split into messages sent in order', async () => {
  const { gateway, callTool } = await startWithMessageFrom('SENDER1')
  const paragraphs = ['a'.repeat(1500), 'b'.repeat(1500), 'c'.repeat(1500)]

  const result = await callTool('reply', { chat_id: 'SENDER1', text: paragraphs.join('\n\n') })

  expect(gateway.sent.map(message => message.text)).toEqual(paragraphs)
  expect(gateway.sent.map(message => message.answering?.sequence)).toEqual([1, 2, 3])
  expect(result.text).toContain('sent-1')
  expect(result.text).toContain('sent-3')
})

test('text with nowhere to break is cut at 2000 characters without losing any', async () => {
  const { gateway, callTool } = await startWithMessageFrom('SENDER1')
  const text = '好'.repeat(4500)

  await callTool('reply', { chat_id: 'SENDER1', text })

  expect(gateway.sent.map(message => message.text!.length)).toEqual([2000, 2000, 500])
  expect(gateway.sent.map(message => message.text).join('')).toBe(text)
})

test('a chunk that fails stops the reply, and the error says what was already sent', async () => {
  const { gateway, callTool } = await startWithMessageFrom('SENDER1')
  gateway.refuse = attempt => (attempt.text?.startsWith('b') ? new Error('QQ is unreachable') : undefined)

  const result = await callTool('reply', {
    chat_id: 'SENDER1',
    text: ['a'.repeat(1500), 'b'.repeat(1500), 'c'.repeat(1500)].join('\n\n'),
  })

  expect(result.isError).toBe(true)
  expect(result.text).toContain('sent-1')
  expect(result.text).toContain('QQ is unreachable')
  expect(gateway.sent).toHaveLength(1)
})

test('reply refuses a conversation that is not an allowlisted Sender', async () => {
  const { gateway, callTool } = await startWithMessageFrom('SENDER1')
  gateway.receive(messageFrom('STRANGER'))
  await settle()
  gateway.sent.length = 0

  const result = await callTool('reply', { chat_id: 'STRANGER', text: 'hello' })

  expect(result.isError).toBe(true)
  expect(result.text).toContain('not on the allowlist')
  expect(gateway.sent).toHaveLength(0)
})

test('the Channel offers the reply tool', async () => {
  const { request } = await startConnected()

  const { tools } = await request('tools/list')

  const reply = tools.find((tool: { name: string }) => tool.name === 'reply')
  expect(reply.inputSchema.required).toEqual(['chat_id', 'text'])
})

test('the instructions cover the reply tool and what QQ cannot do', async () => {
  const { initialize } = await startChannel()
  const { instructions } = await initialize()

  expect(instructions).toContain('reply')
  for (const missing of ['edit', 'reaction', 'history']) expect(instructions).toContain(missing)
})
