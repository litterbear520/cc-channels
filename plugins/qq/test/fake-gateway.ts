import type { Credentials } from '../src/credentials.ts'
import {
  AttachmentTooLargeError,
  type GatewayEvents,
  type SendRefusedError,
  type InboundMessage,
  type OutboundContent,
  type OutboundFile,
  type PassiveReplyTarget,
  type QQGateway,
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
  /**
   * Set to make every message for which this returns an error fail with it.
   * A {@link SendRefusedError} is QQ refusing the message; any other error
   * leaves open whether QQ took it.
   */
  refuse: (attempt: SendAttempt) => Error | undefined = () => undefined
  /** Every message the Channel asked QQ to send, refused ones included, in order. */
  attempts: SendAttempt[] = []
  /** The messages QQ accepted, in order. */
  sent: SentMessage[] = []

  /** The files the Channel uploaded, in order. An upload's reference is `file-info-<n>`, counting from 1. */
  uploads: (OutboundFile & { senderId: string })[] = []
  /** Set to make QQ refuse every upload for which this returns an error. */
  refuseUpload: (file: OutboundFile) => Error | undefined = () => undefined
  /** The typing statuses the Channel showed, in order. */
  typing: { senderId: string; messageId: string }[] = []
  /** Set to make QQ refuse every typing status. */
  refuseTyping: Error | undefined
  /** The URLs the Channel fetched, in order. */
  downloads: string[] = []
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

  async upload(senderId: string, file: OutboundFile): Promise<string> {
    const failure = this.refuseUpload(file)
    if (failure) throw failure
    this.uploads.push({ ...file, senderId })
    return `file-info-${this.uploads.length}`
  }

  async showTyping(senderId: string, messageId: string): Promise<void> {
    if (this.refuseTyping) throw this.refuseTyping
    this.typing.push({ senderId, messageId })
  }

  async download(url: string, maxBytes: number): Promise<Uint8Array> {
    this.downloads.push(url)
    const bytes = this.downloadable.get(url)
    if (!bytes) throw new Error('QQ answered 404 for the attachment')
    if (bytes.byteLength > maxBytes) throw new AttachmentTooLargeError(`the attachment is over ${maxBytes} bytes`)
    return bytes
  }

  async close(): Promise<void> {
    this.connectedWith = undefined
  }
}
