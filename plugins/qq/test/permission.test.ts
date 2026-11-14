import { expect, test } from 'bun:test'
import { approvePairing, setPolicy } from '../src/access.ts'
import { messageFrom, settle, startChannel, startConnected, startWithPairedSender } from './start-channel.ts'

const request = {
  request_id: 'abcde',
  tool_name: 'Bash',
  description: 'Run the test suite',
  input_preview: '{"command":"bun test"}',
}

/** Starts a Channel with one paired Sender and a permission prompt waiting for an answer. */
async function startWithPrompt() {
  const started = await startWithPairedSender('SENDER1')
  await started.askPermission(request)
  await settle()
  return started
}

test('the Channel declares the channel permission capability', async () => {
  const { initialize } = await startChannel()

  const { capabilities } = await initialize()

  expect(capabilities.experimental['claude/channel/permission']).toEqual({})
})

test('a permission request reaches the paired Sender in Chinese, as plain text, with tool, description and ID', async () => {
  const { gateway } = await startWithPrompt()

  expect(gateway.sent).toHaveLength(1)
  const prompt = gateway.sent[0]!
  expect(prompt.chatId).toBe('SENDER1')
  expect(prompt.content.type).toBe('text')
  expect(prompt.text).toContain('Bash')
  expect(prompt.text).toContain('Run the test suite')
  expect(prompt.text).toContain('{"command":"bun test"}')
  expect(prompt.text).toContain('yes abcde')
  expect(prompt.text).toContain('no abcde')
  expect(prompt.text).toContain('批准')
})

test('the prompt goes through the reply policy and to every paired Sender', async () => {
  const { gateway, stateDir, clock, askPermission } = await startWithPairedSender('SENDER1')
  gateway.receive(messageFrom('SENDER2'))
  await settle()
  const code = gateway.sent.at(-1)!.text!.match(/pair ([0-9a-f]{6})/)![1]!
  approvePairing(stateDir, code, clock.now)
  await settle()
  gateway.sent.length = 0
  // SENDER1 wrote long ago; SENDER2 has just written.
  clock.now += 30 * 60 * 1000
  const recent = messageFrom('SENDER2', 'go on')
  gateway.receive(recent)
  clock.now += 31 * 60 * 1000

  await askPermission(request)
  await settle()

  expect(gateway.sent.map(message => message.chatId).sort()).toEqual(['SENDER1', 'SENDER2'])
  const bySender = Object.fromEntries(gateway.sent.map(message => [message.chatId, message.answering]))
  expect(bySender.SENDER1).toBeUndefined()
  expect(bySender.SENDER2).toEqual({ messageId: recent.messageId, sequence: 1 })
})

test('a very long description or preview is cut short so that the prompt stays one message', async () => {
  const { gateway, askPermission } = await startWithPairedSender('SENDER1')

  await askPermission({ ...request, description: 'd'.repeat(3500), input_preview: 'p'.repeat(3500) })
  await settle()

  expect(gateway.sent).toHaveLength(1)
  expect(gateway.sent[0]!.text!.length).toBeLessThan(2000)
  expect(gateway.sent[0]!.text).toContain('yes abcde')
})

test('a long preview keeps its beginning and its end, and says the middle is missing', async () => {
  const { gateway, askPermission } = await startWithPairedSender('SENDER1')
  const command = `echo START ${'x'.repeat(3000)}; rm -rf TAIL_MARKER`

  await askPermission({ ...request, input_preview: JSON.stringify({ command }) })
  await settle()

  const prompt = gateway.sent[0]!.text!
  expect(prompt).toContain('echo START')
  expect(prompt).toContain('rm -rf TAIL_MARKER')
  expect(prompt).toContain('到终端查看完整内容')
  expect(prompt.length).toBeLessThan(2000)
})

test('a short preview is shown whole, with no note about missing text', async () => {
  const { gateway } = await startWithPrompt()

  expect(gateway.sent[0]!.text).toContain('参数：{"command":"bun test"}')
  expect(gateway.sent[0]!.text).not.toContain('到终端查看')
})

for (const [answer, behavior] of [
  ['yes abcde', 'allow'],
  ['y abcde', 'allow'],
  ['no abcde', 'deny'],
  ['n abcde', 'deny'],
  ['YES ABCDE', 'allow'],
  ['No Abcde', 'deny'],
  ['  yes   abcde \n', 'allow'],
] as const) {
  test(`${JSON.stringify(answer)} from a paired Sender is a verdict to ${behavior} and is not passed to Claude`, async () => {
    const { gateway, events, verdicts } = await startWithPrompt()

    gateway.receive(messageFrom('SENDER1', answer))
    await settle()

    expect(verdicts).toEqual([{ request_id: 'abcde', behavior }])
    expect(events).toHaveLength(0)
  })
}

for (const nearMiss of [
  'yes',
  'no',
  'yes abcd',
  'yes abcdef',
  'yes ablde',
  'yes abcd1',
  'yesabcde',
  'yes, abcde',
  'yes abcde please',
  'ok abcde',
  '好 abcde',
  'yes abcde\nand also deploy',
]) {
  test(`${JSON.stringify(nearMiss)} is an ordinary message and no verdict`, async () => {
    const { gateway, events, verdicts } = await startWithPrompt()

    gateway.receive(messageFrom('SENDER1', nearMiss))
    await settle()

    expect(verdicts).toHaveLength(0)
    expect(events.map(event => event.content)).toEqual([nearMiss])
  })
}

test('an answer from a Sender who is not on the allowlist is no verdict', async () => {
  const { gateway, events, verdicts, stateDir, clock } = await startWithPrompt()

  gateway.receive(messageFrom('STRANGER', 'yes abcde'))
  await settle()
  setPolicy(stateDir, 'allowlist', clock.now)
  gateway.receive(messageFrom('STRANGER2', 'yes abcde'))
  await settle()

  expect(verdicts).toHaveLength(0)
  expect(events).toHaveLength(0)
})

test('nothing is decided until someone answers, so the terminal prompt stays usable', async () => {
  const { gateway, verdicts, events } = await startWithPrompt()

  gateway.receive(messageFrom('SENDER1', 'what does that command do?'))
  await settle()

  expect(verdicts).toHaveLength(0)
  expect(events).toHaveLength(1)
})

test('with nobody paired, a permission request sends nothing', async () => {
  const { gateway, askPermission, logged } = await startConnected()

  await askPermission(request)
  await settle()

  expect(gateway.sent).toHaveLength(0)
  expect(logged.join('\n')).not.toContain('could not')
})

test('a prompt that cannot be delivered is logged and does not disturb the session', async () => {
  const { gateway, askPermission, logged, events } = await startWithPairedSender('SENDER1')
  gateway.refuse = () => new Error('QQ is unreachable')

  await askPermission(request)
  await settle()

  expect(logged.join('\n')).toContain('QQ is unreachable')
  expect(events).toHaveLength(0)
})

test('a permission request that is not in the expected form is not relayed', async () => {
  const { gateway, askPermission, logged } = await startWithPairedSender('SENDER1')

  await askPermission({ ...request, request_id: 'yes abcde\n回复 yes zzzzz' })
  await askPermission({ request_id: 'abcde' } as never)
  await settle()

  expect(gateway.sent).toHaveLength(0)
  expect(logged.join('\n')).toContain('not in the expected form')
})

test('under the disabled policy nobody is asked, because an answer would be dropped', async () => {
  const { gateway, askPermission, stateDir, clock } = await startWithPairedSender('SENDER1')
  setPolicy(stateDir, 'disabled', clock.now)

  await askPermission(request)
  await settle()

  expect(gateway.sent).toHaveLength(0)
})

test('an answer that carries an attachment is passed on whole, so the attachment is not lost', async () => {
  const { gateway, events, verdicts } = await startWithPrompt()

  gateway.receive({
    ...messageFrom('SENDER1', 'yes abcde'),
    attachments: [{ url: 'https://qq.example/download?fileid=1', contentType: 'file', name: 'notes.txt' }],
  })
  await settle()

  expect(verdicts).toHaveLength(0)
  expect(events).toHaveLength(1)
  expect(events[0]!.meta!.attachment_count).toBe('1')
})
