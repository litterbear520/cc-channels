import { expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'bun:test'
import { messageFrom, settle, startWithPairedSender } from './start-channel.ts'

const MB = 1024 * 1024

const workDirs: string[] = []
afterEach(() => {
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Starts a Channel whose paired Sender has just written, with a directory of the user's own files. */
async function startWithFiles() {
  const started = await startWithPairedSender('SENDER1')
  const inbound = messageFrom('SENDER1', 'send me the chart')
  started.gateway.receive(inbound)
  await settle()
  const workDir = mkdtempSync(join(tmpdir(), 'qq-channel-files-'))
  workDirs.push(workDir)
  /** Writes a file the user owns and returns its path. */
  const fileNamed = (name: string, content: string | Uint8Array = 'content') => {
    writeFileSync(join(workDir, name), content)
    return join(workDir, name)
  }
  return { ...started, inbound, workDir, fileNamed }
}

test('reply with an image path uploads the image and sends it to the Sender', async () => {
  const { gateway, callTool, fileNamed, inbound } = await startWithFiles()
  const chart = fileNamed('chart.png', 'png bytes')

  const result = await callTool('reply', { chat_id: 'SENDER1', text: '', files: [chart] })

  expect(result.isError).toBe(false)
  expect(gateway.uploads).toHaveLength(1)
  expect(gateway.uploads[0]!.senderId).toBe('SENDER1')
  expect(gateway.uploads[0]!.kind).toBe('image')
  expect(new TextDecoder().decode(gateway.uploads[0]!.data)).toBe('png bytes')
  expect(gateway.sent).toHaveLength(1)
  expect(gateway.sent[0]!.content).toEqual({ type: 'media', fileInfo: 'file-info-1' })
  expect(gateway.sent[0]!.answering).toEqual({ messageId: inbound.messageId, sequence: 1 })
  expect(result.text).toContain('sent-1')
})

test('reply with another kind of file sends it as a file under its own name', async () => {
  const { gateway, callTool, fileNamed } = await startWithFiles()
  const report = fileNamed('report.pdf')

  const result = await callTool('reply', { chat_id: 'SENDER1', text: '', files: [report] })

  expect(result.isError).toBe(false)
  expect(gateway.uploads[0]!.kind).toBe('file')
  expect(gateway.uploads[0]!.name).toBe('report.pdf')
  expect(gateway.sent[0]!.content).toEqual({ type: 'media', fileInfo: 'file-info-1' })
})

test('a reply with text and files delivers the text first and then every file', async () => {
  const { gateway, callTool, fileNamed } = await startWithFiles()

  const result = await callTool('reply', {
    chat_id: 'SENDER1',
    text: 'Here are both.',
    files: [fileNamed('chart.jpg'), fileNamed('data.csv')],
  })

  expect(result.isError).toBe(false)
  expect(gateway.sent.map(message => message.content.type)).toEqual(['markdown', 'media', 'media'])
  expect(gateway.uploads.map(upload => upload.kind)).toEqual(['image', 'file'])
  expect(gateway.sent.map(message => message.answering?.sequence)).toEqual([1, 2, 3])
  for (const id of ['sent-1', 'sent-2', 'sent-3']) expect(result.text).toContain(id)
})

test('a file over 5 MB is refused with the limit, before anything is sent', async () => {
  const { gateway, callTool, fileNamed } = await startWithFiles()
  const small = fileNamed('small.txt')
  const large = fileNamed('video.mp4', new Uint8Array(5 * MB + 1))

  const result = await callTool('reply', { chat_id: 'SENDER1', text: 'Two files.', files: [small, large] })

  expect(result.isError).toBe(true)
  expect(result.text).toContain('video.mp4')
  expect(result.text).toContain('5 MB')
  expect(result.text).toContain('nothing was sent')
  expect(gateway.sent).toHaveLength(0)
  expect(gateway.uploads).toHaveLength(0)
})

test('a file of exactly 5 MB is sent', async () => {
  const { gateway, callTool, fileNamed } = await startWithFiles()

  const result = await callTool('reply', {
    chat_id: 'SENDER1',
    text: '',
    files: [fileNamed('dump.bin', new Uint8Array(5 * MB))],
  })

  expect(result.isError).toBe(false)
  expect(gateway.uploads[0]!.data.byteLength).toBe(5 * MB)
})

test('files in the state directory are refused, except those in the inbox', async () => {
  const { gateway, callTool, stateDir } = await startWithFiles()
  mkdirSync(join(stateDir, 'inbox'))
  writeFileSync(join(stateDir, 'inbox', 'photo.jpg'), 'jpeg bytes')

  for (const secret of ['.env', 'access.json']) {
    const result = await callTool('reply', { chat_id: 'SENDER1', text: '', files: [join(stateDir, secret)] })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('state directory')
  }
  expect(gateway.uploads).toHaveLength(0)

  const fromInbox = await callTool('reply', {
    chat_id: 'SENDER1',
    text: '',
    files: [join(stateDir, 'inbox', 'photo.jpg')],
  })
  expect(fromInbox.isError).toBe(false)
  expect(gateway.uploads).toHaveLength(1)
})

test('a symlink does not get a file out of the state directory', async () => {
  const { gateway, callTool, stateDir, workDir } = await startWithFiles()
  mkdirSync(join(stateDir, 'inbox'))
  // One link from outside, one planted in the inbox, one to the whole directory.
  symlinkSync(join(stateDir, '.env'), join(workDir, 'notes.txt'))
  symlinkSync(join(stateDir, 'access.json'), join(stateDir, 'inbox', 'list.json'))
  symlinkSync(stateDir, join(workDir, 'state'))

  for (const path of [
    join(workDir, 'notes.txt'),
    join(stateDir, 'inbox', 'list.json'),
    join(workDir, 'state', '.env'),
    join(stateDir, 'inbox', '..', '.env'),
  ]) {
    const result = await callTool('reply', { chat_id: 'SENDER1', text: '', files: [path] })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('state directory')
  }
  expect(gateway.uploads).toHaveLength(0)
  expect(gateway.sent).toHaveLength(0)
})

test('a missing file, or a directory, returns a clear error and sends nothing', async () => {
  const { gateway, callTool, workDir } = await startWithFiles()

  const missing = await callTool('reply', { chat_id: 'SENDER1', text: 'hi', files: [join(workDir, 'gone.txt')] })
  const directory = await callTool('reply', { chat_id: 'SENDER1', text: 'hi', files: [workDir] })
  const relative = await callTool('reply', { chat_id: 'SENDER1', text: 'hi', files: ['notes.txt'] })

  expect(missing.isError).toBe(true)
  expect(missing.text).toContain('gone.txt')
  expect(missing.text).toContain('does not exist')
  expect(directory.isError).toBe(true)
  expect(directory.text).toContain('not a file')
  expect(relative.isError).toBe(true)
  expect(relative.text).toContain('absolute')
  expect(gateway.sent).toHaveLength(0)
})

test('once the Passive reply window has closed, a file goes out as a Proactive message', async () => {
  const { gateway, callTool, fileNamed, clock } = await startWithFiles()
  clock.now += 61 * 60 * 1000

  await callTool('reply', { chat_id: 'SENDER1', text: '', files: [fileNamed('chart.png')] })

  expect(gateway.sent[0]!.content.type).toBe('media')
  expect(gateway.sent[0]!.answering).toBeUndefined()
})

test('a file message QQ rejects as a Passive reply is sent once as a Proactive message', async () => {
  const { gateway, callTool, fileNamed } = await startWithFiles()
  gateway.refuse = attempt => (attempt.answering ? new Error('passive reply window closed') : undefined)

  const result = await callTool('reply', { chat_id: 'SENDER1', text: '', files: [fileNamed('chart.png')] })

  expect(result.isError).toBe(false)
  expect(gateway.attempts.map(attempt => attempt.answering?.sequence)).toEqual([1, undefined])
})

test('when a file fails after others went out, the error says what was sent', async () => {
  const { gateway, callTool, fileNamed } = await startWithFiles()
  gateway.refuseUpload = file => (file.name === 'data.csv' ? new Error('QQ refused the upload') : undefined)

  const result = await callTool('reply', {
    chat_id: 'SENDER1',
    text: 'Here are both.',
    files: [fileNamed('chart.jpg'), fileNamed('data.csv'), fileNamed('more.txt')],
  })

  expect(result.isError).toBe(true)
  expect(result.text).toContain('data.csv')
  expect(result.text).toContain('QQ refused the upload')
  expect(result.text).toContain('sent-1, sent-2')
  expect(gateway.sent).toHaveLength(2)
})

test('reply needs text or a file', async () => {
  const { gateway, callTool } = await startWithFiles()

  const result = await callTool('reply', { chat_id: 'SENDER1', text: '' })

  expect(result.isError).toBe(true)
  expect(gateway.sent).toHaveLength(0)
})

test('a file that cannot be read returns a clear error and sends nothing', async () => {
  const { gateway, callTool, fileNamed } = await startWithFiles()
  const locked = fileNamed('locked.txt')
  chmodSync(locked, 0o000)

  const result = await callTool('reply', { chat_id: 'SENDER1', text: 'hi', files: [locked] })

  expect(result.isError).toBe(true)
  expect(result.text).toContain('locked.txt')
  expect(result.text).toContain('could not be read')
  expect(result.text).toContain('nothing was sent')
  expect(gateway.sent).toHaveLength(0)
})
