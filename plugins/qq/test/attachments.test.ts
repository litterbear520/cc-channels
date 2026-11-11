import { expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { InboundAttachment } from '../src/gateway.ts'
import { messageFrom, settle, startWithPairedSender } from './start-channel.ts'

const text = (value: string) => new TextEncoder().encode(value)

const image: InboundAttachment = {
  url: 'https://qq.example/download?fileid=1',
  contentType: 'image/jpeg',
  name: '0123456789abcdef0123456789abcdef.jpg',
  size: 66614,
}
const file: InboundAttachment = {
  url: 'https://qq.example/download?fileid=2',
  contentType: 'file',
  name: 'example.yaml',
  size: 2424,
}

/** The local paths a download_attachment result lists, one per line. */
const pathsIn = (result: string) => result.split('\n').filter(line => line.startsWith('/'))

test('a message with an image says so in its meta, and nothing is downloaded yet', async () => {
  const { gateway, events, stateDir } = await startWithPairedSender('SENDER1')

  gateway.receive({ ...messageFrom('SENDER1', ''), attachments: [image] })
  await settle()

  expect(events).toHaveLength(1)
  expect(events[0]!.meta!.attachment_count).toBe('1')
  expect(events[0]!.meta!.attachments).toContain('image/jpeg')
  expect(events[0]!.meta!.attachments).toContain('65KB')
  expect(events[0]!.content).not.toBe('')
  expect(existsSync(join(stateDir, 'inbox'))).toBe(false)
})

test('a message with a file names the file in its meta', async () => {
  const { gateway, events } = await startWithPairedSender('SENDER1')

  gateway.receive({ ...messageFrom('SENDER1', 'here is the config'), attachments: [file] })
  await settle()

  expect(events[0]!.content).toBe('here is the config')
  expect(events[0]!.meta!.attachment_count).toBe('1')
  expect(events[0]!.meta!.attachments).toContain('example.yaml')
})

test('a message without attachments has no attachment meta', async () => {
  const { gateway, events } = await startWithPairedSender('SENDER1')

  gateway.receive(messageFrom('SENDER1', 'hello'))
  await settle()

  expect(Object.keys(events[0]!.meta!).sort()).toEqual(['chat_id', 'message_id', 'sender_id', 'ts'])
})

test('download_attachment saves the attachments under the inbox and returns their paths', async () => {
  const { gateway, callTool, stateDir } = await startWithPairedSender('SENDER1')
  gateway.downloadable.set(image.url, text('jpeg bytes'))
  gateway.downloadable.set(file.url, text('key: value'))
  const message = { ...messageFrom('SENDER1', ''), attachments: [image, file] }
  gateway.receive(message)
  await settle()

  const result = await callTool('download_attachment', { chat_id: 'SENDER1', message_id: message.messageId })

  expect(result.isError).toBe(false)
  const paths = pathsIn(result.text)
  expect(paths).toHaveLength(2)
  for (const path of paths) expect(dirname(path)).toBe(join(stateDir, 'inbox'))
  expect(paths[0]).toEndWith('.jpg')
  expect(paths[1]).toEndWith('example.yaml')
  expect(readFileSync(paths[0]!, 'utf8')).toBe('jpeg bytes')
  expect(readFileSync(paths[1]!, 'utf8')).toBe('key: value')
  // Readable by the user's account only, like the rest of the state directory.
  expect(statSync(paths[1]!).mode & 0o777).toBe(0o600)
})

test('a hostile file name cannot place an attachment outside the inbox', async () => {
  const { gateway, callTool, stateDir } = await startWithPairedSender('SENDER1')
  const names = ['../../.env', '/etc/passwd', '..\\..\\access.json', '.', '', 'a/b/../../../c.txt', '.env']
  const attachments = names.map((name, index) => ({
    url: `https://qq.example/download?fileid=${index}`,
    contentType: 'file',
    name,
  }))
  for (const attachment of attachments) gateway.downloadable.set(attachment.url, text('hostile'))
  const message = { ...messageFrom('SENDER1', ''), attachments }
  gateway.receive(message)
  await settle()

  const result = await callTool('download_attachment', { chat_id: 'SENDER1', message_id: message.messageId })

  expect(result.isError).toBe(false)
  const paths = pathsIn(result.text)
  expect(paths).toHaveLength(names.length)
  for (const path of paths) {
    expect(dirname(path)).toBe(join(stateDir, 'inbox'))
    expect(path).not.toContain('..')
  }
  expect(readdirSync(join(stateDir, 'inbox'))).toHaveLength(names.length)
  // Nothing was written beside the inbox: only the files the Channel keeps there itself.
  expect(readdirSync(stateDir).sort()).toEqual(['.env', 'access.json', 'approved', 'inbox'])
  expect(readFileSync(join(stateDir, '.env'), 'utf8')).not.toContain('hostile')
})

test('a message the Channel no longer remembers returns an error that explains why', async () => {
  const { callTool } = await startWithPairedSender('SENDER1')

  // Nothing with this ID has arrived since the Channel started, as after a restart.
  const result = await callTool('download_attachment', { chat_id: 'SENDER1', message_id: 'msg-from-yesterday' })

  expect(result.isError).toBe(true)
  expect(result.text).toContain('no longer remembers')
  expect(result.text).toContain('restart')
  expect(result.text).toContain('send it again')
})

test('only the attachments of the most recent messages are remembered', async () => {
  const { gateway, callTool } = await startWithPairedSender('SENDER1')
  gateway.downloadable.set(file.url, text('key: value'))
  const first = { ...messageFrom('SENDER1', ''), attachments: [file] }
  gateway.receive(first)
  const later = Array.from({ length: 200 }, () => ({ ...messageFrom('SENDER1', ''), attachments: [file] }))
  for (const message of later) gateway.receive(message)
  await settle()

  const forgotten = await callTool('download_attachment', { chat_id: 'SENDER1', message_id: first.messageId })
  const remembered = await callTool('download_attachment', { chat_id: 'SENDER1', message_id: later[0]!.messageId })

  expect(forgotten.isError).toBe(true)
  expect(forgotten.text).toContain('no longer remembers')
  expect(remembered.isError).toBe(false)
})

test('download_attachment refuses a conversation that is not an allowlisted Sender', async () => {
  const { gateway, callTool, stateDir } = await startWithPairedSender('SENDER1')
  gateway.downloadable.set(file.url, text('key: value'))
  const message = { ...messageFrom('SENDER1', ''), attachments: [file] }
  gateway.receive(message)
  await settle()

  const result = await callTool('download_attachment', { chat_id: 'STRANGER', message_id: message.messageId })

  expect(result.isError).toBe(true)
  expect(result.text).toContain('not on the allowlist')
  expect(existsSync(join(stateDir, 'inbox'))).toBe(false)
})

test('one Sender cannot fetch the attachments of another Sender\'s message', async () => {
  const { gateway, callTool, stateDir, clock } = await startWithPairedSender('SENDER1')
  const { approvePairing } = await import('../src/access.ts')
  gateway.receive(messageFrom('SENDER2'))
  await settle()
  const code = gateway.sent.at(-1)!.text!.match(/pair ([0-9a-f]{6})/)![1]!
  approvePairing(stateDir, code, clock.now)
  gateway.downloadable.set(file.url, text('key: value'))
  const message = { ...messageFrom('SENDER1', ''), attachments: [file] }
  gateway.receive(message)
  await settle()

  const result = await callTool('download_attachment', { chat_id: 'SENDER2', message_id: message.messageId })

  expect(result.isError).toBe(true)
  expect(existsSync(join(stateDir, 'inbox'))).toBe(false)
})

test('an attachment QQ no longer serves returns an error', async () => {
  const { gateway, callTool } = await startWithPairedSender('SENDER1')
  const message = { ...messageFrom('SENDER1', ''), attachments: [file] }
  gateway.receive(message)
  await settle()

  const result = await callTool('download_attachment', { chat_id: 'SENDER1', message_id: message.messageId })

  expect(result.isError).toBe(true)
  expect(result.text).toContain('404')
})

test('a very long file name is cut to fit a file system, keeping its extension', async () => {
  const { gateway, callTool } = await startWithPairedSender('SENDER1')
  const long = { url: 'https://qq.example/download?fileid=9', contentType: 'file', name: `${'报告'.repeat(200)}.pdf` }
  gateway.downloadable.set(long.url, text('pdf bytes'))
  const message = { ...messageFrom('SENDER1', ''), attachments: [long] }
  gateway.receive(message)
  await settle()

  const result = await callTool('download_attachment', { chat_id: 'SENDER1', message_id: message.messageId })

  expect(result.isError).toBe(false)
  const [path] = pathsIn(result.text)
  expect(path).toEndWith('报告.pdf')
  expect(readFileSync(path!, 'utf8')).toBe('pdf bytes')
})

test('downloads in the same millisecond of files with one name never overwrite each other', async () => {
  // The Channel's clock stands still in tests, so every download below starts in the same millisecond.
  const { gateway, callTool } = await startWithPairedSender('SENDER1')
  const messages = ['first file', 'second file'].map((content, index) => {
    const report = { url: `https://qq.example/download?fileid=report-${index}`, contentType: 'file', name: 'report.txt' }
    gateway.downloadable.set(report.url, text(content))
    return { ...messageFrom('SENDER1', ''), attachments: [report] }
  })
  for (const message of messages) gateway.receive(message)
  await settle()

  const downloads = [messages[0]!, messages[1]!, messages[0]!].map(message =>
    callTool('download_attachment', { chat_id: 'SENDER1', message_id: message.messageId }),
  )
  const results = await Promise.all(downloads)

  expect(results.map(result => result.isError)).toEqual([false, false, false])
  const paths = results.map(result => pathsIn(result.text)[0]!)
  expect(new Set(paths).size).toBe(3)
  expect(paths.map(path => readFileSync(path, 'utf8'))).toEqual(['first file', 'second file', 'first file'])
})
