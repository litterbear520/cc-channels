import { ApiClient, GatewayConnection } from '@tencent-connect/qqbot-nodejs/protocol'
import { createAccessTokenSource } from './access-token.ts'
import type { Credentials } from './credentials.ts'
import {
  CredentialsRejectedError,
  type GatewayEvents,
  type OutboundContent,
  type OutboundFile,
  type PassiveReplyTarget,
  type QQGateway,
} from './gateway.ts'

const USER_AGENT = 'claude-channel-qq/0.0.1'
/** The group-and-direct-chat event group. Subscribing to it needs no approval from QQ. */
const GROUP_AND_DIRECT_CHAT_INTENT = 1 << 25

const QQ_FILE_TYPE_IMAGE = 1
const QQ_FILE_TYPE_FILE = 4

/** The fields of QQ's send-message request that depend on what is sent. */
function messageBody(content: OutboundContent): Record<string, unknown> {
  switch (content.type) {
    case 'text':
      return { msg_type: 0, content: content.text, ...quote(content.quoting) }
    case 'markdown':
      return { msg_type: 2, markdown: { content: content.text }, ...quote(content.quoting) }
    case 'media':
      return { msg_type: 7, media: { file_info: content.fileInfo } }
  }
}

const quote = (ref: string | undefined) => (ref ? { message_reference: { message_id: ref } } : {})

/**
 * The real QQ gateway, on the official SDK's low-level protocol entry. The SDK
 * keeps the WebSocket alive (heartbeat, reconnect, resume); this module adds
 * the access token and decides what is worth a log line.
 *
 * Not covered by `bun test`: it is verified by hand against a real bot.
 */
export function createSdkGateway({
  log,
  trace = () => {},
}: {
  log: (line: string) => void
  /** Receives the routine connection events that `log` leaves out. For troubleshooting. */
  trace?: (line: string) => void
}): QQGateway {
  let live:
    | {
        abort: AbortController
        finished: Promise<void>
        /** Sends one API request with a fresh access token. */
        request: (method: string, path: string, body: unknown) => Promise<unknown>
      }
    | undefined

  return {
    async connect(credentials: Credentials, { onMessage, onLost }: GatewayEvents): Promise<void> {
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
        intents: GROUP_AND_DIRECT_CHAT_INTENT,
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
        // The intent also covers group chats, which the Channel does not serve.
        onMessage: message => {
          if (message.kind !== 'c2c') return
          onMessage({
            messageId: message.messageId,
            senderId: message.senderId,
            text: message.content,
            timestamp: message.timestamp,
            // QQ sends the index as `msg_idx` in the event's `message_scene.ext`.
            ...(message.msgIdx ? { quoteRef: message.msgIdx } : {}),
            attachments: (message.attachments ?? []).map(attachment => ({
              url: attachment.url,
              contentType: attachment.content_type,
              ...(attachment.filename ? { name: attachment.filename } : {}),
              ...(attachment.size !== undefined ? { size: attachment.size } : {}),
            })),
          })
        },
      })

      const finished = connection.start().catch(error => {
        giveUp(error instanceof Error ? error : new Error(String(error)))
      })
      const request = async (method: string, path: string, body: unknown) => {
        try {
          lastToken = await tokens.get()
          return await api.request(lastToken, method, path, body)
        } catch (error) {
          throw new Error(withoutSecrets(error instanceof Error ? error.message : String(error)))
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

    async send(senderId: string, content: OutboundContent, answering?: PassiveReplyTarget): Promise<string> {
      if (!live) throw new Error('not connected to QQ')
      const sent = (await live.request('POST', `/v2/users/${encodeURIComponent(senderId)}/messages`, {
        ...messageBody(content),
        ...(answering ? { msg_id: answering.messageId, msg_seq: answering.sequence } : {}),
      })) as { id?: string } | undefined
      return sent?.id ?? ''
    },

    async upload(senderId: string, file: OutboundFile): Promise<string> {
      if (!live) throw new Error('not connected to QQ')
      // QQ's direct upload: the bytes travel base64-encoded in the request body.
      const uploaded = (await live.request('POST', `/v2/users/${encodeURIComponent(senderId)}/files`, {
        file_type: file.kind === 'image' ? QQ_FILE_TYPE_IMAGE : QQ_FILE_TYPE_FILE,
        srv_send_msg: false,
        file_data: Buffer.from(file.data).toString('base64'),
        ...(file.kind === 'file' ? { file_name: file.name } : {}),
      })) as { file_info?: string } | undefined
      if (!uploaded?.file_info) throw new Error('QQ took the upload but returned no reference to the file')
      return uploaded.file_info
    },

    async download(url: string): Promise<Uint8Array> {
      // QQ serves attachment URLs without an Authorization header, so the access token is not sent.
      if (new URL(url).protocol !== 'https:') throw new Error('the attachment is not at an https address')
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (!response.ok) throw new Error(`QQ answered ${response.status} for the attachment`)
      return new Uint8Array(await response.arrayBuffer())
    },

    async close(): Promise<void> {
      const closing = live
      live = undefined
      closing?.abort.abort()
      await closing?.finished
    },
  }
}
