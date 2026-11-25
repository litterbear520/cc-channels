import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiError, type InboundMessage as SdkInboundMessage } from '@tencent-connect/qqbot-nodejs/protocol'
import { AttachmentTooLargeError, SendRefusedError } from '../src/gateway.ts'
import { createSdkGateway, messageBody, readableFaces, refusedByQQ, toButtonPress, toInboundMessage } from '../src/sdk-gateway.ts'
import { createSessionFile, sessionFile } from '../src/session-file.ts'
import { removeAfterTest } from './cleanup.ts'
import { credentials } from './start-channel.ts'

/*
 * The parts of the real gateway that need no bot: what is sent, how inbound
 * events are read, how a failed request is judged, the download, and the
 * resuming of a saved gateway session. The download runs against a stand-in
 * for fetch, the gateway session against a stand-in for QQ's WebSocket
 * gateway on this machine.
 */

const MiB = 1024 * 1024
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** A body that yields `chunks` bytes at a time, recording how much it produced and whether it was cancelled. */
function body(totalBytes: number, { chunk = MiB, failAfter }: { chunk?: number; failAfter?: number } = {}) {
  const seen = { produced: 0, cancelled: false }
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (failAfter !== undefined && seen.produced >= failAfter) {
          controller.error(new Error('connection reset'))
          return
        }
        if (seen.produced >= totalBytes) {
          controller.close()
          return
        }
        const size = Math.min(chunk, totalBytes - seen.produced)
        seen.produced += size
        controller.enqueue(new Uint8Array(size))
      },
      cancel() {
        seen.cancelled = true
      },
    },
    { highWaterMark: 0 },
  )
  return { stream, seen }
}

/** Has fetch answer every request with this response. */
function serve(response: () => Response): void {
  globalThis.fetch = (async () => response()) as unknown as typeof fetch
}

const download = (url = 'https://qq.example/file', maxBytes = 25 * MiB, downloadTimeoutMs?: number) =>
  createSdkGateway({ log: () => {}, ...(downloadTimeoutMs ? { downloadTimeoutMs } : {}) }).download(url, maxBytes)

test('an attachment of unknown size is cancelled as soon as it passes the limit', async () => {
  const { stream, seen } = body(27 * MiB)
  serve(() => new Response(stream))

  await expect(download()).rejects.toBeInstanceOf(AttachmentTooLargeError)

  expect(seen.cancelled).toBe(true)
  expect(seen.produced).toBeLessThanOrEqual(26 * MiB)
})

test('an attachment QQ states as small but that runs over is cancelled too', async () => {
  const { stream, seen } = body(27 * MiB)
  serve(() => new Response(stream, { headers: { 'Content-Length': '1024' } }))

  await expect(download()).rejects.toBeInstanceOf(AttachmentTooLargeError)

  expect(seen.cancelled).toBe(true)
})

test('an attachment QQ states as too large is refused before its body is read', async () => {
  const { stream, seen } = body(27 * MiB)
  serve(() => new Response(stream, { headers: { 'Content-Length': String(27 * MiB) } }))

  await expect(download()).rejects.toBeInstanceOf(AttachmentTooLargeError)

  expect(seen.produced).toBe(0)
})

test('an attachment of exactly the limit is downloaded whole', async () => {
  const { stream } = body(25 * MiB)
  serve(() => new Response(stream))

  const bytes = await download()

  expect(bytes.byteLength).toBe(25 * MiB)
})

test('a download that breaks off part way fails', async () => {
  const { stream } = body(10 * MiB, { failAfter: 2 * MiB })
  serve(() => new Response(stream))

  await expect(download()).rejects.toThrow('connection reset')
})

test('a download that does not finish in time fails, and its body is cancelled', async () => {
  const seen = { cancelled: false }
  const neverEnds = new ReadableStream<Uint8Array>({
    pull: () => new Promise(() => {}),
    cancel() {
      seen.cancelled = true
    },
  })
  serve(() => new Response(neverEnds))

  await expect(download(undefined, undefined, 50)).rejects.toThrow('did not finish downloading')

  expect(seen.cancelled).toBe(true)
})

test('an attachment at an address other than https is not fetched', async () => {
  let fetched = false
  globalThis.fetch = (async () => {
    fetched = true
    return new Response('')
  }) as unknown as typeof fetch

  await expect(download('http://qq.example/file')).rejects.toThrow('https')

  expect(fetched).toBe(false)
})

test('an error status for the attachment fails with the status', async () => {
  serve(() => new Response('gone', { status: 404 }))

  await expect(download()).rejects.toThrow('404')
})

test('sending while not connected is a refusal: nothing left the machine', async () => {
  const gateway = createSdkGateway({ log: () => {} })

  await expect(gateway.send('SENDER1', { type: 'text', text: 'hi' })).rejects.toBeInstanceOf(SendRefusedError)
})

test('only an error QQ answered with counts as a refusal of the request', () => {
  const path = '/v2/users/SENDER1/messages'
  // QQ answered and explained.
  expect(refusedByQQ(new ApiError('API Error: markdown not allowed', 400, path, 304003, 'markdown not allowed'))).toBe(true)
  expect(refusedByQQ(new ApiError('请求过于频繁，已被限流', 429, path))).toBe(true)
  expect(refusedByQQ(new ApiError('API Error: internal', 500, path, 22009, 'internal'))).toBe(true)
  // The answer was lost, or says nothing about what QQ did.
  expect(refusedByQQ(new ApiError(`Network error [${path}]: socket hang up`, 0, path))).toBe(false)
  expect(refusedByQQ(new ApiError(`Request timeout [${path}]: exceeded 30000ms`, 0, path))).toBe(false)
  expect(refusedByQQ(new ApiError(`Failed to read response [${path}]: aborted`, 400, path))).toBe(false)
  expect(refusedByQQ(new ApiError('调用发生异常，请稍候重试', 502, path))).toBe(false)
  expect(refusedByQQ(new Error('something else'))).toBe(false)
})

test('each kind of outbound content becomes the request fields QQ expects', () => {
  expect(messageBody({ type: 'text', text: 'hi' })).toEqual({ msg_type: 0, content: 'hi' })
  expect(messageBody({ type: 'markdown', text: '**hi**', quoting: 'REFIDX_1' })).toEqual({
    msg_type: 2,
    markdown: { content: '**hi**' },
    message_reference: { message_id: 'REFIDX_1' },
  })
  expect(messageBody({ type: 'media', fileInfo: 'info' })).toEqual({ msg_type: 7, media: { file_info: 'info' } })
})

test('buttons become one row of callback buttons that anyone in the chat may press', () => {
  const body = messageBody({
    type: 'markdown',
    text: 'choose',
    buttons: [
      { label: '允许', pressedLabel: '已选：允许', data: 'permission:allow:abcde', primary: true },
      { label: '拒绝', pressedLabel: '已选：拒绝', data: 'permission:deny:abcde' },
    ],
  }) as { keyboard: { content: { rows: { buttons: Record<string, unknown>[] }[] } } }

  expect(body.keyboard.content.rows).toHaveLength(1)
  expect(body.keyboard.content.rows[0]!.buttons).toMatchObject([
    { id: '1', render_data: { label: '允许', visited_label: '已选：允许', style: 1 }, action: { type: 1, permission: { type: 2 }, data: 'permission:allow:abcde' } },
    { id: '2', render_data: { label: '拒绝', visited_label: '已选：拒绝', style: 0 }, action: { type: 1, permission: { type: 2 }, data: 'permission:deny:abcde' } },
  ])
  expect(messageBody({ type: 'markdown', text: 'plain' })).not.toHaveProperty('keyboard')
})

test('a pressed button names whoever pressed it, in a Direct chat and in a group', () => {
  const pressed = { id: 'event-1', version: 1, type: 11, data: { type: 11, resolved: { button_id: '1', button_data: 'permission:deny:abcde' } } }

  expect(toButtonPress({ ...pressed, scene: 'c2c', user_openid: 'SENDER1' })).toEqual({ senderId: 'SENDER1', data: 'permission:deny:abcde' })
  expect(toButtonPress({ ...pressed, scene: 'group', group_openid: 'GROUP1', group_member_openid: 'SENDER1' })).toEqual({
    senderId: 'SENDER1',
    groupId: 'GROUP1',
    data: 'permission:deny:abcde',
  })
})

test('an interaction that is not a button press, or names nobody, is left out', () => {
  const resolved = { button_data: 'permission:allow:abcde' }
  // What QQ sends when a Sender switches Proactive messages off.
  expect(toButtonPress({ id: 'e', version: 1, type: 18, user_openid: 'SENDER1', data: { type: 18, resolved } })).toBeUndefined()
  expect(toButtonPress({ id: 'e', version: 1, type: 11, data: { type: 11, resolved } })).toBeUndefined()
  expect(toButtonPress({ id: 'e', version: 1, type: 11, group_openid: 'GROUP1', user_openid: 'SENDER1', data: { type: 11, resolved } })).toBeUndefined()
  expect(toButtonPress({ id: 'e', version: 1, type: 11, user_openid: 'SENDER1', data: { type: 11, resolved: {} } })).toBeUndefined()
})

/** A Direct chat event as the SDK hands it over, with the fields the Channel reads. */
const event = (fields: Partial<SdkInboundMessage> = {}): SdkInboundMessage =>
  ({
    rawEventType: 'C2C_MESSAGE_CREATE',
    kind: 'c2c',
    senderId: 'SENDER1',
    content: 'hello',
    messageId: 'ROBOT1.0_abc',
    timestamp: '2026-11-11T09:00:00+08:00',
    raw: {},
    ...fields,
  }) as SdkInboundMessage

test('a Direct chat event becomes an inbound message, attachments and quoting included', () => {
  expect(toInboundMessage(event())).toEqual({
    messageId: 'ROBOT1.0_abc',
    senderId: 'SENDER1',
    text: 'hello',
    timestamp: '2026-11-11T09:00:00+08:00',
    attachments: [],
  })

  const quoting = toInboundMessage(
    event({
      msgType: 103,
      msgElements: [{ content: 'the earlier message' }],
      msgIdx: 'REFIDX_2',
      attachments: [{ url: 'https://qq.example/a', content_type: 'file', filename: 'a.txt', size: 12 }],
    }),
  )
  expect(quoting?.quoted).toEqual({ text: 'the earlier message', attachments: [] })
  expect(quoting?.quoteRef).toBe('REFIDX_2')
  expect(quoting?.attachments).toEqual([{ url: 'https://qq.example/a', contentType: 'file', name: 'a.txt', size: 12 }])
})

test('the images and files of a quoted message come from msg_elements, one without an address included', () => {
  const quoting = toInboundMessage(
    event({
      msgType: 103,
      msgElements: [
        {
          content: '',
          attachments: [
            { url: 'https://qq.example/q', content_type: 'image/png', filename: 'B1.png', size: 4096, width: 10, height: 10 },
            { url: '', content_type: 'image/png' },
          ],
        },
      ],
    }),
  )
  expect(quoting?.quoted).toEqual({
    text: '',
    attachments: [
      { url: 'https://qq.example/q', contentType: 'image/png', name: 'B1.png', size: 4096 },
      { url: '', contentType: 'image/png' },
    ],
  })
  // A message that quotes nothing has no quoted message, whatever msg_elements holds.
  expect(toInboundMessage(event({ msgElements: [{ content: 'x' }] }))?.quoted).toBeUndefined()
})

test('an event from a Guild is left out', () => {
  expect(toInboundMessage(event({ kind: 'guild' }))).toBeUndefined()
  expect(toInboundMessage(event({ kind: 'dm' }))).toBeUndefined()
})

test('a group event QQ sends for a mention becomes a Group chat message that mentions the bot', () => {
  // QQ takes the mention out of this event's text and leaves the space after it.
  const message = toInboundMessage(
    event({ rawEventType: 'GROUP_AT_MESSAGE_CREATE', kind: 'group', groupOpenid: 'GROUP1', senderName: '小明', content: ' 你好' }),
  )

  expect(message).toEqual({
    messageId: 'ROBOT1.0_abc',
    senderId: 'SENDER1',
    senderName: '小明',
    group: { id: 'GROUP1', mentionsBot: true },
    text: '你好',
    timestamp: '2026-11-11T09:00:00+08:00',
    attachments: [],
  })
})

test('in a group that sends every message, the mention list tells whether the bot was mentioned', () => {
  const everyMessage = { rawEventType: 'GROUP_MESSAGE_CREATE', kind: 'group', groupOpenid: 'GROUP1' } as const

  const plain = toInboundMessage(event({ ...everyMessage, content: 'lunch?' }))
  expect(plain?.group).toEqual({ id: 'GROUP1', mentionsBot: false })
  expect(plain?.text).toBe('lunch?')

  const mentioning = toInboundMessage(
    event({
      ...everyMessage,
      content: '<@BOT1> ask <@MEMBER2> about it',
      mentions: [
        { id: 'BOT1', member_openid: 'BOT1', username: 'Vanilla', bot: true, is_you: true },
        { id: 'MEMBER2', member_openid: 'MEMBER2', username: '小红', bot: false },
      ],
    }),
  )
  expect(mentioning?.group).toEqual({ id: 'GROUP1', mentionsBot: true })
  // The bot's own mention is taken out; another member's is shown by name.
  expect(mentioning?.text).toBe('ask @小红 about it')

  const someoneElse = toInboundMessage(
    event({ ...everyMessage, content: '<@MEMBER2> hi', mentions: [{ id: 'MEMBER2', username: '小红', is_you: false }] }),
  )
  expect(someoneElse?.group?.mentionsBot).toBe(false)
})

test("QQ's own emoji in a message's text are shown by name", () => {
  // The form seen in the live check, for the emoji QQ calls 捂脸.
  const face = '<faceType=1,faceId="264",ext="eyJ0ZXh0Ijoi5o2C6IS4In0=">'

  expect(readableFaces(face)).toBe('[捂脸]')
  expect(readableFaces(`好的${face}${face} 谢谢`)).toBe('好的[捂脸][捂脸] 谢谢')
  // A sticker, whose name QQ sends already in brackets.
  expect(readableFaces('<faceType=6,faceId="0",ext="eyJ0ZXh0IjoiW+eJm+mAvF0ifQ==">')).toBe('[牛逼]')
  expect(readableFaces('<faceType=3,faceId="1",ext="not base64 json">')).toBe('[表情]')
  expect(readableFaces('<faceType=1,faceId="2",ext="">')).toBe('[表情]')
  expect(readableFaces('a < b and c > d')).toBe('a < b and c > d')
  expect(toInboundMessage(event({ content: face }))?.text).toBe('[捂脸]')
})

test('a group event without a group ID is left out', () => {
  expect(toInboundMessage(event({ kind: 'group' }))).toBeUndefined()
})

/**
 * A stand-in for QQ's WebSocket gateway on this machine, with fetch answering
 * the access token and the gateway's address. `onFrame` answers each frame
 * the SDK sends.
 */
function serveGateway(onFrame: (frame: { op: number; d: any }, send: (payload: unknown) => void) => void) {
  const frames: { op: number; d: any }[] = []
  const server = Bun.serve({
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response('not a WebSocket', { status: 400 })),
    websocket: {
      open: ws => void ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 45_000 } })),
      message: (ws, data) => {
        const frame = JSON.parse(String(data))
        frames.push(frame)
        onFrame(frame, payload => ws.send(JSON.stringify(payload)))
      },
    },
  })
  globalThis.fetch = (async (url: string | URL) =>
    String(url).includes('getAppAccessToken')
      ? Response.json({ access_token: 'test-access-token', expires_in: '7200' })
      : Response.json({ url: `ws://localhost:${server.port}` })) as unknown as typeof fetch
  return { frames, stop: () => server.stop(true) }
}

const OP_IDENTIFY = 2
const OP_RESUME = 6
const OP_INVALID_SESSION = 9
const ready = (sessionId: string) => ({ op: 0, s: 1, t: 'READY', d: { session_id: sessionId, user: { id: 'bot' } } })

test('the real gateway resumes the gateway session saved in the state directory', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'qq-sdk-session-'))
  removeAfterTest(stateDir)
  const session = createSessionFile({ stateDir, appId: credentials.appId, log: () => {} })
  session.save({ sessionId: 'saved-session', lastSeq: 7 })
  const qq = serveGateway((frame, send) => {
    if (frame.op === OP_RESUME) send({ op: 0, s: 8, t: 'RESUMED', d: {} })
  })
  const gateway = createSdkGateway({ log: () => {} })
  try {
    await gateway.connect(credentials, { onMessage() {}, onButton() {}, onLost() {} }, session)

    expect(qq.frames.map(frame => frame.op)).toEqual([OP_RESUME])
    expect(qq.frames[0]!.d).toMatchObject({ session_id: 'saved-session', seq: 7 })
    expect(JSON.parse(readFileSync(sessionFile(stateDir), 'utf8'))).toMatchObject({ sessionId: 'saved-session', lastSeq: 8 })

    // Stopping keeps the gateway session for the next start.
    await gateway.close()
    expect(JSON.parse(readFileSync(sessionFile(stateDir), 'utf8'))).toMatchObject({ sessionId: 'saved-session', lastSeq: 8 })
  } finally {
    await gateway.close()
    qq.stop()
  }
})

test('when QQ will not resume the saved gateway session, the real gateway removes it and starts a new one', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'qq-sdk-session-'))
  removeAfterTest(stateDir)
  const session = createSessionFile({ stateDir, appId: credentials.appId, log: () => {} })
  session.save({ sessionId: 'expired-session', lastSeq: 7 })
  let fileAfterRefusal: boolean | undefined
  const qq = serveGateway((frame, send) => {
    if (frame.op === OP_RESUME) {
      send({ op: OP_INVALID_SESSION, d: false })
      // The SDK clears the file as it reads the refusal, and logs in again a few seconds later.
      setTimeout(() => (fileAfterRefusal = existsSync(sessionFile(stateDir))), 500)
    }
    if (frame.op === OP_IDENTIFY) send(ready('new-session'))
  })
  const gateway = createSdkGateway({ log: () => {} })
  try {
    await gateway.connect(credentials, { onMessage() {}, onButton() {}, onLost() {} }, session)

    expect(fileAfterRefusal).toBe(false)
    expect(qq.frames.map(frame => frame.op)).toEqual([OP_RESUME, OP_IDENTIFY])
    expect(JSON.parse(readFileSync(sessionFile(stateDir), 'utf8'))).toMatchObject({ sessionId: 'new-session', lastSeq: 1 })
  } finally {
    await gateway.close()
    qq.stop()
  }
}, 10_000)
