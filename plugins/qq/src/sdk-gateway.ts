import { ApiClient, GatewayConnection } from '@tencent-connect/qqbot-nodejs/protocol'
import { createAccessTokenSource } from './access-token.ts'
import type { Credentials } from './credentials.ts'
import { CredentialsRejectedError, type QQGateway } from './gateway.ts'

const USER_AGENT = 'claude-channel-qq/0.0.1'
/** The group-and-direct-chat event group. Subscribing to it needs no approval from QQ. */
const GROUP_AND_DIRECT_CHAT_INTENT = 1 << 25

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
  let live: { abort: AbortController; finished: Promise<void> } | undefined

  return {
    async connect(credentials: Credentials, onLost: (error: Error) => void): Promise<void> {
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
        // Inbound messages are not handled yet.
        onMessage: () => {},
      })

      const finished = connection.start().catch(error => {
        giveUp(error instanceof Error ? error : new Error(String(error)))
      })
      live = { abort, finished }

      try {
        await accepted
      } catch (error) {
        live = undefined
        throw error
      }
    },

    async close(): Promise<void> {
      const closing = live
      live = undefined
      closing?.abort.abort()
      await closing?.finished
    },
  }
}
