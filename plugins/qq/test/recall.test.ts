import { expect, test } from 'bun:test'
import { groupMessageFrom, messageFrom, settle, startWithPairedSender } from './start-channel.ts'

const SECOND_MS = 1000

/** Starts a Channel whose paired Sender has been sent one message, and returns that message's ID. */
async function startWithSentMessage() {
  const started = await startWithPairedSender('SENDER1')
  started.gateway.receive(messageFrom('SENDER1'))
  await settle()
  const result = await started.callTool('reply', { chat_id: 'SENDER1', text: 'the wrong answer' })
  const sentId = started.gateway.sent[0]!.id
  expect(result.text).toContain(sentId)
  return { ...started, sentId }
}

test('the Channel offers a recall tool', async () => {
  const { request } = await startWithPairedSender('SENDER1')

  const { tools } = await request('tools/list')

  expect(tools.map((tool: { name: string }) => tool.name)).toContain('recall')
})

test('recall takes back a message reply sent, given the ID reply returned', async () => {
  const { gateway, callTool, sentId, clock } = await startWithSentMessage()
  clock.now += 119 * SECOND_MS

  const result = await callTool('recall', { chat_id: 'SENDER1', message_id: sentId })

  expect(result.isError).toBe(false)
  expect(result.text).toContain(`took back message ${sentId}`)
  expect(gateway.recalled).toEqual([{ chatId: 'SENDER1', messageId: sentId }])
})

test('two minutes after sending, recall refuses without asking QQ and says why', async () => {
  const { gateway, callTool, sentId, clock } = await startWithSentMessage()
  clock.now += 120 * SECOND_MS

  const result = await callTool('recall', { chat_id: 'SENDER1', message_id: sentId })

  expect(result.isError).toBe(true)
  expect(result.text).toContain('only within two minutes')
  expect(gateway.recalled).toHaveLength(0)
})

test('recall refuses a message the Channel did not send, one sent to another chat, and one already taken back', async () => {
  const { gateway, callTool, sentId, stateDir, clock } = await startWithSentMessage()

  // An inbound message's ID, or any other, is not one the Channel sent.
  expect((await callTool('recall', { chat_id: 'SENDER1', message_id: 'msg-1' })).isError).toBe(true)
  // The right ID with the wrong chat.
  gateway.receive(groupMessageFrom('SENDER1', 'GROUP1'))
  await settle()
  const { approvePairing } = await import('../src/access.ts')
  approvePairing(stateDir, /pair ([0-9a-f]{6})/.exec(gateway.sent.at(-1)!.text!)![1]!, clock.now)
  const elsewhere = await callTool('recall', { chat_id: 'group:GROUP1', message_id: sentId })
  expect(elsewhere.isError).toBe(true)
  expect(elsewhere.text).toContain('no record of sending')
  expect(gateway.recalled).toHaveLength(0)

  expect((await callTool('recall', { chat_id: 'SENDER1', message_id: sentId })).isError).toBe(false)
  expect((await callTool('recall', { chat_id: 'SENDER1', message_id: sentId })).isError).toBe(true)
  expect(gateway.recalled).toHaveLength(1)
})

test("recall reports QQ's refusal, and the message can be tried again", async () => {
  const { gateway, callTool, sentId } = await startWithSentMessage()
  gateway.refuseRecall = new Error('QQ answered 400: 消息已超过撤回时间')

  const refused = await callTool('recall', { chat_id: 'SENDER1', message_id: sentId })
  expect(refused.isError).toBe(true)
  expect(refused.text).toContain('消息已超过撤回时间')

  gateway.refuseRecall = undefined
  expect((await callTool('recall', { chat_id: 'SENDER1', message_id: sentId })).isError).toBe(false)
})

test('recall refuses a chat that may not be reached, and wrong arguments', async () => {
  const { gateway, callTool, sentId } = await startWithSentMessage()

  expect((await callTool('recall', { chat_id: 'STRANGER', message_id: sentId })).isError).toBe(true)
  expect((await callTool('recall', { chat_id: 'SENDER1' })).isError).toBe(true)
  expect(gateway.recalled).toHaveLength(0)
})

test('every message of an answer with files can be taken back, in a group too', async () => {
  const started = await startWithPairedSender('SENDER1')
  const { gateway, callTool, stateDir, clock } = started
  gateway.receive(groupMessageFrom('SENDER1', 'GROUP1'))
  await settle()
  const { approvePairing } = await import('../src/access.ts')
  approvePairing(stateDir, /pair ([0-9a-f]{6})/.exec(gateway.sent[0]!.text!)![1]!, clock.now)
  await settle()
  gateway.receive(groupMessageFrom('SENDER1', 'GROUP1'))
  await settle()
  const before = gateway.sent.length

  await callTool('reply', { chat_id: 'group:GROUP1', text: 'a picture', files: [`${import.meta.dir}/start-channel.ts`] })
  const ids = gateway.sent.slice(before).map(sent => sent.id)
  expect(ids).toHaveLength(2)
  for (const id of ids) expect((await callTool('recall', { chat_id: 'group:GROUP1', message_id: id })).isError).toBe(false)

  expect(gateway.recalled).toEqual(ids.map(messageId => ({ chatId: 'group:GROUP1', messageId })))
})
