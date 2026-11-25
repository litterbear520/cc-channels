import { expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { messageFrom, settle, startWithPairedSender } from './start-channel.ts'

const text = (value: string) => new TextEncoder().encode(value)

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
    quoted: { text: 'Option A: rebase.\nOption B: merge.', attachments: [] },
  })
  await settle()

  expect(events[0]!.content).toBe('> Option A: rebase.\n> Option B: merge.\n\ndo this one first')
  expect(events[0]!.meta!.quoting).toBe('true')
})

test('a long quoted text is cut short, and a quoted message without text is still marked', async () => {
  const { gateway, events } = await startWithPairedSender('SENDER1')

  gateway.receive({ ...messageFrom('SENDER1', 'what was this about?'), quoted: { text: 'x'.repeat(5000), attachments: [] } })
  gateway.receive({ ...messageFrom('SENDER1', 'and this picture?'), quoted: { text: '', attachments: [] } })
  await settle()

  expect(events[0]!.content.length).toBeLessThan(700)
  expect(events[0]!.content).toEndWith('what was this about?')
  expect(events[1]!.content).toBe('> (a message without text)\n\nand this picture?')
})

test('a quoted "yes <id>" is not a verdict: only what the Sender wrote counts', async () => {
  const { gateway, events, verdicts } = await startWithPairedSender('SENDER1')

  gateway.receive({ ...messageFrom('SENDER1', 'what does this mean?'), quoted: { text: 'yes abcde', attachments: [] } })
  await settle()

  expect(verdicts).toHaveLength(0)
  expect(events).toHaveLength(1)
})

test('the images and files of a quoted message are shown in the quote and can be downloaded', async () => {
  const { gateway, events, callTool, stateDir } = await startWithPairedSender('SENDER1')
  const own = { url: 'https://qq.example/own', contentType: 'file', name: 'notes.txt', size: 1024 }
  const picture = { url: 'https://qq.example/quoted', contentType: 'image/png', name: 'B1A2C3.png', size: 4096 }
  const report = { url: 'https://qq.example/report', contentType: 'file', name: 'report.pdf' }
  gateway.downloadable.set(own.url, text('own'))
  gateway.downloadable.set(picture.url, text('picture'))
  gateway.downloadable.set(report.url, text('report'))
  const message = {
    ...messageFrom('SENDER1', 'this one'),
    quoted: { text: '', attachments: [picture, report] },
    attachments: [own],
  }
  gateway.receive(message)
  await settle()

  expect(events[0]!.content).toBe('> [image]\n> [file: report.pdf]\n\nthis one')
  expect(events[0]!.meta!.attachment_count).toBe('3')
  expect(events[0]!.meta!.attachments).toBe(
    'notes.txt (file, 1KB); quoted: B1A2C3.png (image/png, 4KB); quoted: report.pdf (file)',
  )

  const result = await callTool('download_attachment', { chat_id: 'SENDER1', message_id: message.messageId })
  const paths = result.text.split('\n').slice(1)
  expect(paths).toHaveLength(3)
  expect(paths.map(path => readFileSync(path, 'utf8'))).toEqual(['own', 'picture', 'report'])
  for (const path of paths) expect(path.startsWith(join(stateDir, 'inbox'))).toBe(true)
})

test('a quoted image without text alongside it still reaches Claude with its text', async () => {
  const { gateway, events } = await startWithPairedSender('SENDER1')
  const picture = { url: 'https://qq.example/quoted', contentType: 'image/jpeg' }

  gateway.receive({ ...messageFrom('SENDER1', '这个吧'), quoted: { text: 'two options', attachments: [picture] } })
  await settle()

  expect(events[0]!.content).toBe('> two options\n> [image]\n\n这个吧')
  expect(events[0]!.meta!.attachment_count).toBe('1')
})

test('a quoted attachment QQ sent without an address is named in the quote, logged, and not offered for download', async () => {
  const { gateway, events, logged, stateDir } = await startWithPairedSender('SENDER1')
  const message = {
    ...messageFrom('SENDER1', '这个吧'),
    quoted: { text: '', attachments: [{ url: '', contentType: 'image/png' }] },
  }
  gateway.receive(message)
  await settle()

  expect(events[0]!.content).toBe('> [image] (not downloadable: QQ sent no address)\n\n这个吧')
  expect(events[0]!.meta!.attachment_count).toBeUndefined()
  expect(logged.some(line => line.includes('1 attachment(s) without an address'))).toBe(true)
  const received = readFileSync(join(stateDir, 'received.jsonl'), 'utf8')
  expect(received).toContain('not downloadable')
})

test('a quoted image whose address has expired leaves the other attachments to download', async () => {
  const { gateway, callTool } = await startWithPairedSender('SENDER1')
  const own = { url: 'https://qq.example/own', contentType: 'image/jpeg', name: 'new.jpg' }
  const expired = { url: 'https://qq.example/expired', contentType: 'image/jpeg', name: 'old.jpg' }
  gateway.downloadable.set(own.url, text('new'))
  const message = { ...messageFrom('SENDER1', '比较两张图'), attachments: [own], quoted: { text: '', attachments: [expired] } }
  gateway.receive(message)
  await settle()

  const result = await callTool('download_attachment', { chat_id: 'SENDER1', message_id: message.messageId })

  expect(result.isError).toBe(false)
  const paths = result.text.split('\n').filter(line => line.startsWith('/'))
  expect(paths.map(path => readFileSync(path, 'utf8'))).toEqual(['new'])
  expect(result.text).toContain('not downloaded: old.jpg')
})

test('a long quoted text is cut before the placeholders, so they still show', async () => {
  const { gateway, events } = await startWithPairedSender('SENDER1')

  gateway.receive({
    ...messageFrom('SENDER1', '分析配图'),
    quoted: { text: '字'.repeat(5000), attachments: [{ url: '', contentType: 'image/png' }] },
  })
  await settle()

  expect(events[0]!.content).toEndWith('…\n> [image] (not downloadable: QQ sent no address)\n\n分析配图')
})

test('the received log names the attachments of a quoted message', async () => {
  const { gateway, stateDir } = await startWithPairedSender('SENDER1')
  const picture = { url: 'https://qq.example/quoted', contentType: 'image/png', name: 'B1.png' }

  gateway.receive({ ...messageFrom('SENDER1', '这个吧'), quoted: { text: '', attachments: [picture] } })
  await settle()

  const line = JSON.parse(readFileSync(join(stateDir, 'received.jsonl'), 'utf8').trim())
  expect(line.text).toBe('> [image]\n\n这个吧')
  expect(line.attachments).toEqual(['quoted: B1.png'])
})

test('a message without a quote has no quoting meta', async () => {
  const { gateway, events } = await startWithPairedSender('SENDER1')

  gateway.receive(messageFrom('SENDER1', 'hello'))
  await settle()

  expect(events[0]!.meta!.quoting).toBeUndefined()
})
