import { afterEach, expect, test } from 'bun:test'
import { ApiError, type InboundMessage as SdkInboundMessage } from '@tencent-connect/qqbot-nodejs/protocol'
import { AttachmentTooLargeError, SendRefusedError } from '../src/gateway.ts'
import { createSdkGateway, messageBody, refusedByQQ, toInboundMessage } from '../src/sdk-gateway.ts'

/*
 * The parts of the real gateway that need no bot: what is sent, how inbound
 * events are read, how a failed request is judged, and the download. The
 * download runs against a stand-in for fetch.
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
  expect(quoting?.quoted).toEqual({ text: 'the earlier message' })
  expect(quoting?.quoteRef).toBe('REFIDX_2')
  expect(quoting?.attachments).toEqual([{ url: 'https://qq.example/a', contentType: 'file', name: 'a.txt', size: 12 }])
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

test('a group event without a group ID is left out', () => {
  expect(toInboundMessage(event({ kind: 'group' }))).toBeUndefined()
})
