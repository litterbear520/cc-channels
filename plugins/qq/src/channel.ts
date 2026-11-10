import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { readCredentials } from './credentials.ts'
import { CredentialsRejectedError, type QQGateway } from './gateway.ts'

export interface Channel {
  /** Serves Claude Code over the transport and begins connecting to QQ. */
  start(transport: Transport): Promise<void>
  /** Disconnects from QQ and closes the transport. */
  stop(): Promise<void>
}

export interface ChannelOptions {
  gateway: QQGateway
  /** Directory holding the credentials file. */
  stateDir: string
  /** Receives one line per event worth a trace. Never given a secret. */
  log?: (line: string) => void
}

export function createChannel({ gateway, stateDir, log = () => {} }: ChannelOptions): Channel {
  const mcp = new Server(
    { name: 'qq', version: '0.0.1' },
    // The presence of this key is what makes Claude Code treat the server as a Channel.
    { capabilities: { experimental: { 'claude/channel': {} } } },
  )

  let announceInitialized = () => {}
  const initialized = new Promise<void>(resolve => (announceInitialized = resolve))
  mcp.oninitialized = () => announceInitialized()

  /**
   * Reports a problem the user has to act on. Stderr is only visible in debug
   * logs, so the problem is also pushed into the session as a Channel event.
   */
  async function reportProblem(problem: string): Promise<void> {
    log(problem)
    // Claude Code drops events sent before its handshake is done.
    await initialized
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: { content: problem, meta: { kind: 'status' } },
    })
  }

  const reportingFailed = (error: unknown) => log(`could not report a connection problem: ${error}`)

  async function connectToQQ(): Promise<void> {
    const credentials = readCredentials(stateDir)
    if (!credentials) {
      await reportProblem(
        'The QQ channel is not connected: no credentials are stored. ' +
          'Ask the user to run /qq:configure <AppID> <AppSecret>, then restart Claude Code.',
      )
      return
    }
    const withoutSecret = (text: string) => text.replaceAll(credentials.appSecret, '***')
    const onLost = (error: Error) => {
      void reportProblem(
        `The QQ channel lost its connection and will not reconnect: ${withoutSecret(error.message)}. ` +
          'Tell the user; once the cause is fixed, restarting Claude Code connects again.',
      ).catch(reportingFailed)
    }
    try {
      await gateway.connect(credentials, onLost)
      log('connected to QQ')
    } catch (error) {
      if (error instanceof CredentialsRejectedError) {
        await reportProblem(
          `The QQ channel is not connected: ${error.message}. ` +
            'Ask the user to check the AppID and AppSecret in the QQ open platform console and run ' +
            '/qq:configure <AppID> <AppSecret> again, then restart Claude Code.',
        )
        return
      }
      const reason = withoutSecret(error instanceof Error ? error.message : String(error))
      await reportProblem(`The QQ channel is not connected: ${reason}. Restart Claude Code to try again.`)
    }
  }

  return {
    async start(transport) {
      await mcp.connect(transport)
      // Not awaited: Claude Code must not wait on QQ to finish its handshake.
      void connectToQQ().catch(reportingFailed)
    },
    async stop() {
      try {
        await gateway.close()
      } finally {
        await mcp.close()
      }
    },
  }
}
