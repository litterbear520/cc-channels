import { expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { messageFrom, settle, startWithPairedSender } from './start-channel.ts'

const MB = 1024 * 1024
const request = { request_id: 'abcde', tool_name: 'Bash', description: 'Run the tests', input_preview: '{}' }

test('a delivered message shows the bot as typing in the Direct chat', async () => {
  const { gateway } = await startWithPairedSender('SENDER1')

  const message = messageFrom('SENDER1', 'run the tests')
  gateway.receive(message)
  await settle()

  expect(gateway.typing).toEqual([{ senderId: 'SENDER1', messageId: message.messageId }])
})

test('nobody sees typing for a message that is not delivered to Claude', async () => {
  const { gateway, askPermission } = await startWithPairedSender('SENDER1')
  await askPermission(request)

  gateway.receive(messageFrom('STRANGER'))
  gateway.receive(messageFrom('SENDER1', 'yes abcde'))
  await settle()

  expect(gateway.typing).toHaveLength(0)
})

test('a typing status QQ refuses does not keep the message from Claude', async () => {
  const { gateway, events, logged } = await startWithPairedSender('SENDER1')
  gateway.refuseTyping = new Error('typing is not available')

  gateway.receive(messageFrom('SENDER1', 'run the tests'))
  await settle()

  expect(events.map(event => event.content)).toEqual(['run the tests'])
  expect(logged.join('\n')).not.toContain('could not handle')
})

for (const [answer, word] of [
  ['yes abcde', '允许'],
  ['no abcde', '拒绝'],
] as const) {
  test(`the Sender who answers ${JSON.stringify(answer)} is told in the Direct chat that it was taken`, async () => {
    const { gateway, askPermission } = await startWithPairedSender('SENDER1')
    await askPermission(request)
    await settle()
    gateway.sent.length = 0

    const message = messageFrom('SENDER1', answer)
    gateway.receive(message)
    await settle()

    expect(gateway.sent).toHaveLength(1)
    expect(gateway.sent[0]!.content.type).toBe('text')
    expect(gateway.sent[0]!.text).toContain(word)
    expect(gateway.sent[0]!.text).toContain('abcde')
    expect(gateway.sent[0]!.answering).toEqual({ messageId: message.messageId, sequence: 1 })
  })
}

test('an acknowledgement that cannot be sent does not lose the verdict', async () => {
  const { gateway, verdicts, logged } = await startWithPairedSender('SENDER1')
  gateway.refuse = () => new Error('QQ is unreachable')

  gateway.receive(messageFrom('SENDER1', 'yes abcde'))
  await settle()

  expect(verdicts).toEqual([{ request_id: 'abcde', behavior: 'allow' }])
  expect(logged.join('\n')).toContain('QQ is unreachable')
})

test('an attachment QQ reports as over 25 MB is refused without being fetched', async () => {
  const { gateway, callTool, stateDir } = await startWithPairedSender('SENDER1')
  const huge = { url: 'https://qq.example/huge', contentType: 'file', name: 'backup.zip', size: 25 * MB + 1 }
  gateway.downloadable.set(huge.url, new Uint8Array(1))
  const message = { ...messageFrom('SENDER1', ''), attachments: [huge] }
  gateway.receive(message)
  await settle()

  const result = await callTool('download_attachment', { chat_id: 'SENDER1', message_id: message.messageId })

  expect(result.isError).toBe(true)
  expect(result.text).toContain('backup.zip')
  expect(result.text).toContain('25 MB')
  expect(gateway.downloads).toHaveLength(0)
  expect(readdirSync(join(stateDir, 'inbox'))).toHaveLength(0)
})

test('an attachment that turns out to be over 25 MB is not saved', async () => {
  const { gateway, callTool, stateDir } = await startWithPairedSender('SENDER1')
  // QQ reports no size for this one, so it is only found out once fetched.
  const unsized = { url: 'https://qq.example/unsized', contentType: 'file', name: 'dump.bin' }
  gateway.downloadable.set(unsized.url, new Uint8Array(25 * MB + 1))
  const message = { ...messageFrom('SENDER1', ''), attachments: [unsized] }
  gateway.receive(message)
  await settle()

  const result = await callTool('download_attachment', { chat_id: 'SENDER1', message_id: message.messageId })

  expect(result.isError).toBe(true)
  expect(result.text).toContain('25 MB')
  expect(existsSync(join(stateDir, 'inbox', 'dump.bin'))).toBe(false)
})

test('a message that quotes another arrives with the quoted text in front of it', async () => {
  const { gateway, events } = await startWithPairedSender('SENDER1')

  gateway.receive({
    ...messageFrom('SENDER1', 'do this one first'),
    quoted: { text: 'Option A: rebase.\nOption B: merge.' },
  })
  await settle()

  expect(events[0]!.content).toBe('> Option A: rebase.\n> Option B: merge.\n\ndo this one first')
  expect(events[0]!.meta!.quoting).toBe('true')
})

test('a long quoted text is cut short, and a quoted message without text is still marked', async () => {
  const { gateway, events } = await startWithPairedSender('SENDER1')

  gateway.receive({ ...messageFrom('SENDER1', 'what was this about?'), quoted: { text: 'x'.repeat(5000) } })
  gateway.receive({ ...messageFrom('SENDER1', 'and this picture?'), quoted: { text: '' } })
  await settle()

  expect(events[0]!.content.length).toBeLessThan(700)
  expect(events[0]!.content).toEndWith('what was this about?')
  expect(events[1]!.content).toBe('> (a message without text)\n\nand this picture?')
})

test('a quoted "yes <id>" is not a verdict: only what the Sender wrote counts', async () => {
  const { gateway, events, verdicts } = await startWithPairedSender('SENDER1')

  gateway.receive({ ...messageFrom('SENDER1', 'what does this mean?'), quoted: { text: 'yes abcde' } })
  await settle()

  expect(verdicts).toHaveLength(0)
  expect(events).toHaveLength(1)
})

test('a message without a quote has no quoting meta', async () => {
  const { gateway, events } = await startWithPairedSender('SENDER1')

  gateway.receive(messageFrom('SENDER1', 'hello'))
  await settle()

  expect(events[0]!.meta!.quoting).toBeUndefined()
})
