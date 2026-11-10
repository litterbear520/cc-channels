import type { Credentials } from '../src/credentials.ts'
import type { GatewayEvents, InboundMessage, PassiveReplyTarget, QQGateway } from '../src/gateway.ts'

export interface SentText {
  senderId: string
  text: string
  /** Set when the text went out as a Passive reply. */
  answering?: PassiveReplyTarget
}

/** In-memory QQ gateway. Tests drive the Channel through it instead of a real bot. */
export class FakeQQGateway implements QQGateway {
  /** The credentials of the live connection, or undefined when not connected. */
  connectedWith: Credentials | undefined
  connectAttempts = 0
  /** Set to make QQ refuse the next connection. */
  failNextConnectWith: Error | undefined
  /** Set to make QQ refuse the next message the Channel sends. */
  failNextSendWith: Error | undefined
  /** Everything the Channel sent to QQ, in order. */
  sent: SentText[] = []

  private events: GatewayEvents | undefined

  async connect(credentials: Credentials, events: GatewayEvents): Promise<void> {
    this.connectAttempts++
    const failure = this.failNextConnectWith
    if (failure) {
      this.failNextConnectWith = undefined
      throw failure
    }
    this.connectedWith = credentials
    this.events = events
  }

  /** Delivers a Direct chat message, as QQ would. */
  receive(message: InboundMessage): void {
    this.events?.onMessage(message)
  }

  /** Ends the live connection for good, as when QQ bans the bot. */
  loseConnection(error: Error): void {
    this.connectedWith = undefined
    this.events?.onLost(error)
  }

  async sendText(senderId: string, text: string, answering?: PassiveReplyTarget): Promise<void> {
    const failure = this.failNextSendWith
    if (failure) {
      this.failNextSendWith = undefined
      throw failure
    }
    this.sent.push({ senderId, text, ...(answering ? { answering } : {}) })
  }

  async close(): Promise<void> {
    this.connectedWith = undefined
  }
}
