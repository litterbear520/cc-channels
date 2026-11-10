import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { QQGateway } from './gateway.ts'

export interface Channel {
  /** Serves Claude Code over the transport, then connects to QQ. */
  start(transport: Transport): Promise<void>
  /** Disconnects from QQ and closes the transport. */
  stop(): Promise<void>
}

export function createChannel({ gateway }: { gateway: QQGateway }): Channel {
  const mcp = new Server(
    { name: 'qq', version: '0.0.1' },
    // The presence of this key is what makes Claude Code treat the server as a Channel.
    { capabilities: { experimental: { 'claude/channel': {} } } },
  )

  return {
    async start(transport) {
      await mcp.connect(transport)
      await gateway.connect()
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
