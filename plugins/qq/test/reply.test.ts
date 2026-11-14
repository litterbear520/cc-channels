import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { approvePairing } from '../src/access.ts'
import { SendRefusedError } from '../src/gateway.ts'
import { createReplyPolicy, PASSIVE_REPLIES_PER_MESSAGE } from '../src/reply-policy.ts'
import { FakeQQGateway } from './fake-gateway.ts'
import { credentials, messageFrom, settle, startChannel, startConnected, startWithPairedSender } from './start-channel.ts'

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
  expect(gateway.sent[0]!.chatId).toBe('SENDER1')
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
  gateway.refuse = attempt => (attempt.content.type === 'markdown' ? new SendRefusedError('markdown not allowed') : undefined)

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
  gateway.refuse = attempt => (attempt.answering ? new SendRefusedError('passive reply window closed') : undefined)

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
  gateway.refuse = attempt => (attempt.content.type === 'markdown' ? new SendRefusedError('markdown not allowed') : undefined)

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
    new SendRefusedError(attempt.answering ? 'passive reply window closed' : 'the user has switched proactive messages off')

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

test('text that is only whitespace is refused instead of sent as an empty message', async () => {
  const { gateway, callTool } = await startWithMessageFrom('SENDER1')

  const result = await callTool('reply', { chat_id: 'SENDER1', text: ' \n ' })

  expect(result.isError).toBe(true)
  expect(gateway.attempts).toHaveLength(0)
})

test('when both forms of a Proactive message are rejected, reply returns an error naming both', async () => {
  const { gateway, callTool, clock } = await startWithMessageFrom('SENDER1')
  clock.now += 61 * MINUTE_MS
  gateway.refuse = attempt => new SendRefusedError(`${attempt.content.type} refused`)

  const result = await callTool('reply', { chat_id: 'SENDER1', text: 'done' })

  expect(result.isError).toBe(true)
  expect(result.text).toContain('markdown refused')
  expect(result.text).toContain('text refused')
  expect(gateway.attempts.map(attempt => attempt.answering)).toEqual([undefined, undefined])
})

test('splitting keeps the indentation of the line a new message starts with', async () => {
  const { gateway, callTool } = await startWithMessageFrom('SENDER1')
  const first = 'a'.repeat(1990)
  const second = `    ${'b'.repeat(300)}`

  await callTool('reply', { chat_id: 'SENDER1', text: `${first}\n${second}` })

  expect(gateway.sent.map(message => message.text)).toEqual([first, second])
})

test('reply_to shows the answer in QQ as quoting that message, on the first message only', async () => {
  const { gateway, callTool } = await startWithPairedSender('SENDER1')
  const question = { ...messageFrom('SENDER1', 'is the build green?'), quoteRef: 'REFIDX_question' }
  const later = { ...messageFrom('SENDER1', 'and the deploy?'), quoteRef: 'REFIDX_later' }
  gateway.receive(question)
  gateway.receive(later)
  await settle()

  const result = await callTool('reply', {
    chat_id: 'SENDER1',
    reply_to: question.messageId,
    text: ['a'.repeat(1500), 'b'.repeat(1500)].join('\n\n'),
  })

  expect(result.isError).toBe(false)
  expect(gateway.sent[0]!.content).toEqual({ type: 'markdown', text: 'a'.repeat(1500), quoting: 'REFIDX_question' })
  expect(gateway.sent[1]!.content).toEqual({ type: 'markdown', text: 'b'.repeat(1500) })
  // Quoting does not change which message the Passive reply answers: still the latest.
  expect(gateway.sent[0]!.answering).toEqual({ messageId: later.messageId, sequence: 1 })
})

test('the plain-text resend of a rejected Markdown message keeps the quote', async () => {
  const { gateway, callTool } = await startWithPairedSender('SENDER1')
  const question = { ...messageFrom('SENDER1', 'is the build green?'), quoteRef: 'REFIDX_question' }
  gateway.receive(question)
  await settle()
  gateway.refuse = attempt => (attempt.content.type === 'markdown' ? new SendRefusedError('markdown not allowed') : undefined)

  await callTool('reply', { chat_id: 'SENDER1', reply_to: question.messageId, text: 'yes' })

  expect(gateway.sent[0]!.content).toEqual({ type: 'text', text: 'yes', quoting: 'REFIDX_question' })
})

test('a reply_to the Channel cannot quote is sent without a quote, and the result says so', async () => {
  const { gateway, callTool, stateDir, clock } = await startWithPairedSender('SENDER1')
  gateway.receive(messageFrom('SENDER2'))
  await settle()
  approvePairing(stateDir, gateway.sent.at(-1)!.text!.match(/pair ([0-9a-f]{6})/)![1]!, clock.now)
  await settle()
  const others = { ...messageFrom('SENDER2', 'hello'), quoteRef: 'REFIDX_others' }
  const unquotable = messageFrom('SENDER1', 'no index on this one')
  gateway.receive(others)
  gateway.receive(unquotable)
  await settle()
  gateway.sent.length = 0

  // Forgotten or never seen, another Sender's message, and one QQ gave no index for.
  for (const replyTo of ['msg-from-yesterday', others.messageId, unquotable.messageId]) {
    const result = await callTool('reply', { chat_id: 'SENDER1', reply_to: replyTo, text: 'done' })
    expect(result.isError).toBe(false)
    expect(result.text).toContain('without the quote')
  }
  expect(gateway.sent).toHaveLength(3)
  for (const message of gateway.sent) expect(message.content).toEqual({ type: 'markdown', text: 'done' })
})

test('a reply without reply_to quotes nothing', async () => {
  const { gateway, callTool } = await startWithPairedSender('SENDER1')
  gateway.receive({ ...messageFrom('SENDER1', 'hello'), quoteRef: 'REFIDX_hello' })
  await settle()

  const result = await callTool('reply', { chat_id: 'SENDER1', text: 'hi' })

  expect(gateway.sent[0]!.content).toEqual({ type: 'markdown', text: 'hi' })
  expect(result.text).not.toContain('quote')
})

test('a send whose outcome QQ never reported is not tried again in any form, and the result says it may have arrived', async () => {
  const { gateway, callTool } = await startWithMessageFrom('SENDER1')
  gateway.refuse = () => new Error(`Network error: socket hang up (${credentials.appSecret})`)

  const result = await callTool('reply', { chat_id: 'SENDER1', text: 'one answer' })

  expect(result.isError).toBe(true)
  expect(result.text).toContain('may or may not have arrived')
  expect(result.text).toContain('socket hang up')
  expect(result.text).not.toContain(credentials.appSecret)
  expect(gateway.attempts).toHaveLength(1)
})

test('a send QQ took but whose answer was lost goes out once', async () => {
  const gateway = new FakeQQGateway()
  const send = gateway.send.bind(gateway)
  gateway.send = async (...args) => {
    await send(...args)
    throw new Error('Network error: connection reset before the response arrived')
  }
  const policy = createReplyPolicy({ gateway, now: () => 1000 })
  policy.noteInbound('SENDER1', 'message-1')

  await expect(
    policy.deliver('SENDER1', [{ type: 'markdown', text: 'one answer' }, { type: 'text', text: 'one answer' }]),
  ).rejects.toThrow('may or may not have taken')

  expect(gateway.sent).toHaveLength(1)
})

test('messages sent at the same time take no more Passive replies than are left', async () => {
  const gateway = new FakeQQGateway()
  const policy = createReplyPolicy({ gateway, now: () => 1000 })
  policy.noteInbound('SENDER1', 'message-1')
  for (let i = 1; i < PASSIVE_REPLIES_PER_MESSAGE; i++) await policy.deliver('SENDER1', [{ type: 'text', text: `${i}` }])

  await Promise.all([
    policy.deliver('SENDER1', [{ type: 'text', text: 'last a' }]),
    policy.deliver('SENDER1', [{ type: 'text', text: 'last b' }]),
  ])

  expect(gateway.sent.filter(message => message.answering)).toHaveLength(PASSIVE_REPLIES_PER_MESSAGE)
  expect(gateway.sent.filter(message => !message.answering)).toHaveLength(1)
})

test('five messages sent at once to one Sender use four Passive replies, and other Senders keep their own', async () => {
  const gateway = new FakeQQGateway()
  const policy = createReplyPolicy({ gateway, now: () => 1000 })
  policy.noteInbound('SENDER1', 'message-1')
  policy.noteInbound('SENDER2', 'message-2')

  await Promise.all([
    ...Array.from({ length: 5 }, (_, i) => policy.deliver('SENDER1', [{ type: 'text', text: `part ${i}` }])),
    policy.deliver('SENDER2', [{ type: 'text', text: 'other' }]),
  ])

  const passive = (senderId: string) => gateway.sent.filter(message => message.chatId === senderId && message.answering)
  expect(passive('SENDER1')).toHaveLength(PASSIVE_REPLIES_PER_MESSAGE)
  expect(passive('SENDER2')).toHaveLength(1)
})

test('a Passive reply QQ refused gives its place back', async () => {
  const gateway = new FakeQQGateway()
  const policy = createReplyPolicy({ gateway, now: () => 1000 })
  policy.noteInbound('SENDER1', 'message-1')
  let refuseNext = true
  gateway.refuse = attempt => {
    if (!attempt.answering || !refuseNext) return undefined
    refuseNext = false
    return new SendRefusedError('passive reply refused')
  }

  await policy.deliver('SENDER1', [{ type: 'text', text: 'refused, then proactive' }])
  for (let i = 0; i < PASSIVE_REPLIES_PER_MESSAGE; i++) await policy.deliver('SENDER1', [{ type: 'text', text: `${i}` }])

  expect(gateway.sent.filter(message => message.answering)).toHaveLength(PASSIVE_REPLIES_PER_MESSAGE)
})

test('reply arguments of the wrong type are refused, naming the field, and nothing is sent', async () => {
  const { gateway, callTool } = await startWithMessageFrom('SENDER1')

  const calls = [
    { args: { chat_id: 'SENDER1', text: 'here is the file', files: '/tmp/missing.txt' }, field: 'files' },
    { args: { chat_id: 'SENDER1', text: 'here', files: ['/tmp/a.txt', 42] }, field: 'files' },
    { args: { chat_id: 'SENDER1', text: { message: 'hello' } }, field: 'text' },
    { args: { chat_id: 'SENDER1' }, field: 'text' },
    { args: { chat_id: 12345, text: 'hello' }, field: 'chat_id' },
    { args: { text: 'hello' }, field: 'chat_id' },
    { args: { chat_id: 'SENDER1', text: 'hello', reply_to: 7 }, field: 'reply_to' },
  ]
  for (const { args, field } of calls) {
    const result = await callTool('reply', args)
    expect(result.isError).toBe(true)
    expect(result.text).toContain(field)
  }

  expect(gateway.attempts).toHaveLength(0)
  expect(gateway.uploads).toHaveLength(0)
})

test('download_attachment arguments of the wrong type are refused and nothing is fetched', async () => {
  const { gateway, callTool } = await startWithMessageFrom('SENDER1')

  for (const args of [{ chat_id: 'SENDER1' }, { chat_id: 'SENDER1', message_id: 1 }, { message_id: 'm' }]) {
    expect((await callTool('download_attachment', args)).isError).toBe(true)
  }

  expect(gateway.downloads).toHaveLength(0)
})

test('an optional reply argument given as null counts as left out', async () => {
  const { gateway, callTool } = await startWithMessageFrom('SENDER1')

  const result = await callTool('reply', { chat_id: 'SENDER1', text: 'hello', reply_to: null, files: null })

  expect(result.isError).toBe(false)
  expect(gateway.sent).toHaveLength(1)
})
