import type { Credentials } from '../src/credentials.ts'
import type {
  GatewayEvents,
  InboundMessage,
  OutboundContent,
  PassiveReplyTarget,
  QQGateway,
} from '../src/gateway.ts'

/** One message the Channel asked QQ to send. */
export interface SendAttempt {
  senderId: string
  content: OutboundContent
  /** The text of a text or Markdown message. */
  text?: string
  /** Set when the message went out as a Passive reply. */
  answering?: PassiveReplyTarget
}

export interface SentMessage extends SendAttempt {
  /** The message ID QQ returned. */
  id: string
}

/** In-memory QQ gateway. Tests drive the Channel through it instead of a real bot. */
export class FakeQQGateway implements QQGateway {
  /** The credentials of the live connection, or undefined when not connected. */
  connectedWith: Credentials | undefined
  connectAttempts = 0
  /** Set to make QQ refuse the next connection. */
  failNextConnectWith: Error | undefined
  /** Set to make QQ refuse every message for which this returns an error. */
  refuse: (attempt: SendAttempt) => Error | undefined = () => undefined
  /** Every message the Channel asked QQ to send, refused ones included, in order. */
  attempts: SendAttempt[] = []
  /** The messages QQ accepted, in order. */
  sent: SentMessage[] = []

  /** The attachments QQ serves, keyed by URL. */
  downloadable = new Map<string, Uint8Array>()

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

  async send(senderId: string, content: OutboundContent, answering?: PassiveReplyTarget): Promise<string> {
    const attempt: SendAttempt = {
      senderId,
      content,
      ...('text' in content ? { text: content.text } : {}),
      ...(answering ? { answering } : {}),
    }
    this.attempts.push(attempt)
    const failure = this.refuse(attempt)
    if (failure) throw failure
    const id = `sent-${this.sent.length + 1}`
    this.sent.push({ ...attempt, id })
    return id
  }

  async download(url: string): Promise<Uint8Array> {
    const bytes = this.downloadable.get(url)
    if (!bytes) throw new Error('QQ answered 404 for the attachment')
    return bytes
  }

  async close(): Promise<void> {
    this.connectedWith = undefined
  }
}
