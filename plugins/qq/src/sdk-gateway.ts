import {
  ApiClient,
  ApiError,
  GatewayConnection,
  type InteractionEvent,
  type InboundMessage as SdkInboundMessage,
} from '@tencent-connect/qqbot-nodejs/protocol'
import { createAccessTokenSource } from './access-token.ts'
import { groupIdOf } from './chat-id.ts'
import type { Credentials } from './credentials.ts'
import {
  AttachmentTooLargeError,
  CredentialsRejectedError,
  SendRefusedError,
  type Button,
  type ButtonPress,
  type GatewayEvents,
  type InboundMessage,
  type OutboundContent,
  type OutboundFile,
  type PassiveReplyTarget,
  type QQGateway,
} from './gateway.ts'

const USER_AGENT = 'claude-channel-qq/0.0.1'
/** The group-and-direct-chat event group. Subscribing to it needs no approval from QQ. */
const GROUP_AND_DIRECT_CHAT_INTENT = 1 << 25
/** Button presses. Subscribing to it needs no approval from QQ either. */
const INTERACTION_INTENT = 1 << 26
/** The `type` of the interaction event QQ sends for a pressed message button. */
const QQ_INTERACTION_BUTTON = 11

/** The `message_type` of an inbound message that quotes another; the quoted one comes in `msg_elements`. */
const QQ_MESSAGE_TYPE_QUOTE = 103
/** How long one typing status lasts. QQ allows 60 at most. */
const TYPING_SECONDS = 30
const QQ_FILE_TYPE_IMAGE = 1
const QQ_FILE_TYPE_FILE = 4
/** How long one attachment may take to download, from the request to the last byte. */
const DOWNLOAD_TIMEOUT_MS = 120_000

/** The fields of QQ's send-message request that depend on what is sent. */
export function messageBody(content: OutboundContent): Record<string, unknown> {
  switch (content.type) {
    case 'text':
      return { msg_type: 0, content: content.text, ...quote(content.quoting) }
    case 'markdown':
      return {
        msg_type: 2,
        markdown: { content: content.text },
        ...quote(content.quoting),
        ...(content.buttons?.length ? { keyboard: keyboard(content.buttons) } : {}),
      }
    case 'media':
      return { msg_type: 7, media: { file_info: content.fileInfo } }
  }
}

const quote = (ref: string | undefined) => (ref ? { message_reference: { message_id: ref } } : {})

/** QQ's form of one row of callback buttons that anyone in the chat may press. */
const keyboard = (buttons: Button[]) => ({
  content: {
    rows: [
      {
        buttons: buttons.map((button, index) => ({
          id: String(index + 1),
          render_data: { label: button.label, visited_label: button.pressedLabel, style: button.primary ? 1 : 0 },
          action: { type: 1, permission: { type: 2 }, data: button.data, unsupport_tips: '当前 QQ 版本不支持按钮，请用文字回复' },
        })),
      },
    ],
  },
})

/** The Channel's form of a pressed message button, or undefined for any other interaction or one with nobody to name. */
export function toButtonPress(event: InteractionEvent): ButtonPress | undefined {
  if (event.type !== QQ_INTERACTION_BUTTON) return undefined
  const data = event.data?.resolved?.button_data
  const senderId = event.group_openid ? event.group_member_openid : event.user_openid
  if (!data || !senderId) return undefined
  return { senderId, data, ...(event.group_openid ? { groupId: event.group_openid } : {}) }
}

/** QQ sends this event only for a group message that mentions the bot, with the mention already taken out. */
const GROUP_MENTION_EVENT = 'GROUP_AT_MESSAGE_CREATE'

/** The path of QQ's API for one chat, to which `/messages` or `/files` is added. */
const chatPath = (chatId: string) => {
  const groupId = groupIdOf(chatId)
  return groupId === undefined ? `/v2/users/${encodeURIComponent(chatId)}` : `/v2/groups/${encodeURIComponent(groupId)}`
}

/**
 * A group message's text as a person would read it. When the group lets the
 * bot receive every message, QQ leaves each mention in the text as `<@ID>`:
 * the bot's own is taken out, and another member's becomes `@` and their name.
 */
function groupText(message: SdkInboundMessage): string {
  let text = message.content
  for (const mention of message.mentions ?? []) {
    const id = mention.member_openid ?? mention.id
    if (!id) continue
    const name = mention.username || mention.nickname
    text = text.replaceAll(`<@${id}>`, mention.is_you ? '' : `@${name || 'someone'}`)
  }
  return text.trim()
}

/**
 * QQ writes one of its own emoji into a message's text as
 * `<faceType=1,faceId="264",ext="...">`, where `ext` is base64 for JSON such
 * as `{"text":"捂脸"}`, or `{"text":"[牛逼]"}` for a sticker. Each becomes
 * its name in brackets, `[捂脸]`, or `[表情]` when QQ gives no name that can
 * be read.
 */
export function readableFaces(text: string): string {
  return text.replace(/<faceType=\d+,faceId="[^"]*",ext="([^"]*)">/g, (_face, ext: string) => {
    try {
      const text = (JSON.parse(Buffer.from(ext, 'base64').toString('utf8')) as { text?: unknown }).text
      // A sticker's name comes with brackets of its own.
      const name = typeof text === 'string' ? text.replace(/^\[(.*)\]$/, '$1') : ''
      // The name may be the Sender's to choose, so only a short plain one is shown.
      if (/^[^\[\]<>\n]{1,20}$/.test(name)) return `[${name}]`
    } catch {
      // Falls through to the nameless form.
    }
    return '[表情]'
  })
}

/** The Channel's form of a Direct chat or Group chat message from the SDK, or undefined for any other kind of chat. */
export function toInboundMessage(message: SdkInboundMessage): InboundMessage | undefined {
  // The intent's other scenes, such as a Guild, are not served.
  if (message.kind !== 'c2c' && message.kind !== 'group') return undefined
  const inGroup = message.kind === 'group'
  if (inGroup && !message.groupOpenid) return undefined
  return {
    messageId: message.messageId,
    senderId: message.senderId,
    ...(inGroup && message.senderName ? { senderName: message.senderName } : {}),
    ...(inGroup
      ? {
          group: {
            id: message.groupOpenid!,
            mentionsBot:
              message.rawEventType === GROUP_MENTION_EVENT || (message.mentions ?? []).some(mention => mention.is_you === true),
          },
        }
      : {}),
    text: readableFaces(inGroup ? groupText(message) : message.content),
    timestamp: message.timestamp,
    ...(message.msgType === QQ_MESSAGE_TYPE_QUOTE ? { quoted: { text: message.msgElements?.[0]?.content ?? '' } } : {}),
    // QQ sends the index as `msg_idx` in the event's `message_scene.ext`.
    ...(message.msgIdx ? { quoteRef: message.msgIdx } : {}),
    attachments: (message.attachments ?? []).map(attachment => ({
      url: attachment.url,
      contentType: attachment.content_type,
      ...(attachment.filename ? { name: attachment.filename } : {}),
      ...(attachment.size !== undefined ? { size: attachment.size } : {}),
    })),
  }
}

/**
 * True when a failed API request certainly left QQ without what was sent:
 * QQ answered with an error status it explained, or a 4xx. The SDK reports a
 * network failure or a timeout with status 0, and a response it could not
 * read with QQ's status; in those, and in an unexplained 5xx, QQ may have
 * acted on the request before the answer was lost.
 */
export function refusedByQQ(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  if (error.message.startsWith('Failed to read response')) return false
  if (error.httpStatus >= 400 && error.httpStatus < 500) return true
  return error.httpStatus >= 500 && error.bizCode !== undefined
}

/**
 * Reads a body up to `maxBytes`, cancelling it as soon as more arrive, and
 * gives up after `timeoutMs` in all. `abort` is signalled on either, to stop
 * the request behind the body.
 */
export async function readAtMost(
  body: ReadableStream<Uint8Array> | null,
  { maxBytes, timeoutMs, abort }: { maxBytes: number; timeoutMs: number; abort?: AbortController },
): Promise<Uint8Array> {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  let timedOut = false
  const deadline = setTimeout(() => {
    timedOut = true
    abort?.abort()
    // A pending read then ends, as if the body were done; timedOut tells the two apart.
    void reader.cancel().catch(() => {})
  }, timeoutMs)
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (timedOut) break
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        abort?.abort()
        await reader.cancel().catch(() => {})
        throw new AttachmentTooLargeError(`the attachment is over ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } catch (error) {
    if (!timedOut) throw error
  } finally {
    clearTimeout(deadline)
  }
  if (timedOut) throw new Error(`the attachment did not finish downloading within ${Math.round(timeoutMs / 1000)} seconds`)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/**
 * The real QQ gateway, on the official SDK's low-level protocol entry. The SDK
 * keeps the WebSocket alive (heartbeat, reconnect, resume); this module adds
 * the access token and decides what is worth a log line.
 *
 * `bun test` covers the parts that need no bot: the message bodies, the
 * mapping of inbound events, the reading of send failures, and the download.
 * The connection itself is verified by hand against a real bot.
 */
export function createSdkGateway({
  log,
  trace = () => {},
  downloadTimeoutMs = DOWNLOAD_TIMEOUT_MS,
}: {
  log: (line: string) => void
  /** Receives the routine connection events that `log` leaves out. For troubleshooting. */
  trace?: (line: string) => void
  /** Injected by tests. */
  downloadTimeoutMs?: number
}): QQGateway {
  let live:
    | {
        abort: AbortController
        finished: Promise<void>
        /**
         * Sends one API request with a fresh access token. Rejects with
         * {@link SendRefusedError} when QQ certainly did not act on it.
         */
        request: (method: string, path: string, body: unknown) => Promise<unknown>
      }
    | undefined

  return {
    async connect(credentials: Credentials, { onMessage, onButton, onLost }: GatewayEvents): Promise<void> {
      if (live) throw new Error('already connected to QQ')

      const tokens = createAccessTokenSource({ credentials })
      let lastToken = ''
      const withoutSecrets = (text: string) => {
        const hidden = text.replaceAll(credentials.appSecret, '***')
        return lastToken ? hidden.replaceAll(lastToken, '***') : hidden
      }

      // Checked before the SDK's retry loop starts, so that bad credentials
      // fail at once instead of being retried.
      try {
        lastToken = await tokens.get()
      } catch (error) {
        if (error instanceof CredentialsRejectedError) throw error
        log(`${withoutSecrets(String(error))}; will keep trying`)
      }

      const abort = new AbortController()
      const api = new ApiClient({ userAgent: USER_AGENT })

      let settleConnect: { resolve: () => void; reject: (error: Error) => void } | undefined
      const accepted = new Promise<void>((resolve, reject) => (settleConnect = { resolve, reject }))
      /** Ends the connection for good. Before QQ accepted it, that fails `connect`; after, it is reported as lost. */
      const giveUp = (error: Error) => {
        abort.abort()
        const reason = withoutSecrets(error.message)
        if (settleConnect) {
          settleConnect.reject(
            error instanceof CredentialsRejectedError ? new CredentialsRejectedError(reason) : new Error(reason),
          )
        } else {
          live = undefined
          onLost(new Error(reason))
        }
        settleConnect = undefined
      }

      // Set while the connection is down for a reason other than QQ asking for a reconnect.
      let inOutage = false
      const onConnected = () => {
        settleConnect?.resolve()
        settleConnect = undefined
        if (inOutage) log('reconnected to QQ')
        inOutage = false
      }

      const connection = new GatewayConnection({
        account: { accountId: 'qq', appId: credentials.appId, clientSecret: credentials.appSecret },
        abortSignal: abort.signal,
        userAgent: USER_AGENT,
        intents: GROUP_AND_DIRECT_CHAT_INTENT | INTERACTION_INTENT,
        // The SDK's info output narrates every routine reconnect, so it is kept
        // out of the log. Its debug level prints payloads and is not taken at all.
        log: {
          info: message => trace(withoutSecrets(message)),
          warn: message => log(withoutSecrets(message)),
          error: message => log(withoutSecrets(message)),
        },
        getAccessToken: async () => {
          try {
            lastToken = await tokens.get()
            return lastToken
          } catch (error) {
            // Without this the SDK would retry rejected credentials forever.
            if (error instanceof CredentialsRejectedError) giveUp(error)
            throw error
          }
        },
        clearTokenCache: () => tokens.forget(),
        getGatewayUrl: async accessToken => {
          const gateway = await api.request<{ url: string }>(accessToken, 'GET', '/gateway')
          return gateway.url
        },
        onReady: onConnected,
        onResumed: onConnected,
        onError: () => {
          inOutage = true
        },
        // QQ asks for a reconnect about once an hour and the SDK resumes within
        // seconds, so a disconnect that will be retried is not worth a line.
        onDisconnected: event => trace(`disconnected (${event.code} ${event.reason}), reconnecting: ${event.willReconnect}`),
        onMessage: event => {
          const message = toInboundMessage(event)
          if (message) onMessage(message)
        },
        onInteraction: event => {
          // QQ sends other interactions here too, such as a Sender switching Proactive messages off.
          if (event.type !== QQ_INTERACTION_BUTTON) return
          // Until QQ is told the press arrived, the button keeps spinning in the client.
          live?.request('PUT', `/interactions/${encodeURIComponent(event.id)}`, { code: 0 }).catch(error => {
            trace(`could not acknowledge a button press: ${error instanceof Error ? error.message : String(error)}`)
          })
          const press = toButtonPress(event)
          if (press) onButton(press)
        },
      })

      const finished = connection.start().catch(error => {
        giveUp(error instanceof Error ? error : new Error(String(error)))
      })
      const request = async (method: string, path: string, body: unknown) => {
        const reason = (error: unknown) => withoutSecrets(error instanceof Error ? error.message : String(error))
        let token: string
        try {
          token = lastToken = await tokens.get()
        } catch (error) {
          // Without a token nothing was sent.
          throw new SendRefusedError(reason(error))
        }
        try {
          return await api.request(token, method, path, body)
        } catch (error) {
          throw refusedByQQ(error) ? new SendRefusedError(reason(error)) : new Error(reason(error))
        }
      }
      live = { abort, finished, request }

      try {
        await accepted
      } catch (error) {
        live = undefined
        throw error
      }
    },

    async send(chatId: string, content: OutboundContent, answering?: PassiveReplyTarget): Promise<string> {
      if (!live) throw new SendRefusedError('not connected to QQ')
      const sent = (await live.request('POST', `${chatPath(chatId)}/messages`, {
        ...messageBody(content),
        ...(answering ? { msg_id: answering.messageId, msg_seq: answering.sequence } : {}),
      })) as { id?: string } | undefined
      return sent?.id ?? ''
    },

    async showTyping(senderId: string, messageId: string): Promise<void> {
      if (!live) throw new Error('not connected to QQ')
      await live.request('POST', `/v2/users/${encodeURIComponent(senderId)}/messages`, {
        msg_type: 6,
        input_notify: { input_type: 1, input_second: TYPING_SECONDS },
        msg_id: messageId,
        msg_seq: 1,
      })
    },

    async upload(chatId: string, file: OutboundFile): Promise<string> {
      if (!live) throw new Error('not connected to QQ')
      // QQ's direct upload: the bytes travel base64-encoded in the request body.
      // A file uploaded for one chat cannot be sent to another.
      const uploaded = (await live.request('POST', `${chatPath(chatId)}/files`, {
        file_type: file.kind === 'image' ? QQ_FILE_TYPE_IMAGE : QQ_FILE_TYPE_FILE,
        srv_send_msg: false,
        file_data: Buffer.from(file.data).toString('base64'),
        ...(file.kind === 'file' ? { file_name: file.name } : {}),
      })) as { file_info?: string } | undefined
      if (!uploaded?.file_info) throw new Error('QQ took the upload but returned no reference to the file')
      return uploaded.file_info
    },

    async recall(chatId: string, messageId: string): Promise<void> {
      if (!live) throw new Error('not connected to QQ')
      await live.request('DELETE', `${chatPath(chatId)}/messages/${encodeURIComponent(messageId)}`, undefined)
    },

    async download(url: string, maxBytes: number): Promise<Uint8Array> {
      // QQ serves attachment URLs without an Authorization header, so the access token is not sent.
      if (new URL(url).protocol !== 'https:') throw new Error('the attachment is not at an https address')
      const startedAt = Date.now()
      const abort = new AbortController()
      const deadline = setTimeout(() => abort.abort(), downloadTimeoutMs)
      let response: Response
      try {
        response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: abort.signal })
      } catch (error) {
        if (abort.signal.aborted) {
          throw new Error(`the attachment did not finish downloading within ${Math.round(downloadTimeoutMs / 1000)} seconds`)
        }
        throw error
      } finally {
        clearTimeout(deadline)
      }
      const giveUp = () => response.body?.cancel().catch(() => {})
      if (!response.ok) {
        void giveUp()
        throw new Error(`QQ answered ${response.status} for the attachment`)
      }
      // A size QQ gives up front saves the download; the bytes are still counted, as it may be wrong or missing.
      if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
        void giveUp()
        throw new AttachmentTooLargeError(`the attachment is over ${maxBytes} bytes`)
      }
      // One time limit covers the whole download, so the body gets what the request left of it.
      const timeoutMs = Math.max(1, downloadTimeoutMs - (Date.now() - startedAt))
      return readAtMost(response.body, { maxBytes, timeoutMs, abort })
    },

    async close(): Promise<void> {
      const closing = live
      live = undefined
      closing?.abort.abort()
      await closing?.finished
    },
  }
}
