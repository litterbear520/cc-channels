import type { Credentials } from './credentials.ts'

/**
 * The only seam between the Channel and QQ. Everything that talks to the QQ
 * Bot API sits behind this interface, so tests run against a fake and the SDK
 * can be swapped without touching the Channel's logic.
 */
export interface QQGateway {
  /**
   * Connects to QQ and resolves once QQ has accepted the connection. From then
   * on the gateway keeps the connection alive by itself.
   *
   * Rejects with {@link CredentialsRejectedError} when QQ refuses the
   * credentials; the gateway does not try them again. Trouble reaching QQ does
   * not reject: the gateway keeps trying until it gets through.
   *
   * `events.onLost` is called if, after that, the connection ends for good: QQ
   * has shut the bot out, or has stopped accepting the credentials. Drops that
   * the gateway recovers from are not reported.
   */
  connect(credentials: Credentials, events: GatewayEvents): Promise<void>
  /**
   * Sends one message to a Sender's Direct chat: as a Passive reply when
   * `answering` names an inbound message, otherwise as a Proactive message.
   * Resolves with the ID QQ gave the message; rejects when QQ does not accept it.
   */
  send(senderId: string, content: OutboundContent, answering?: PassiveReplyTarget): Promise<string>
  /** Closes the connection. Safe to call when not connected. */
  close(): Promise<void>
}

export interface GatewayEvents {
  /** A message arrived in a Direct chat. QQ may deliver the same message more than once. */
  onMessage(message: InboundMessage): void
  onLost(error: Error): void
}

/** A message a Sender wrote to the bot in a Direct chat. */
export interface InboundMessage {
  messageId: string
  /** QQ's `user_openid`, which also identifies the Direct chat. */
  senderId: string
  text: string
  /** When the Sender wrote it, as QQ reports it (ISO 8601). */
  timestamp: string
}

/** What one outbound message carries. QQ renders `markdown` in a Direct chat and shows `text` as written. */
export type OutboundContent = { type: 'text'; text: string } | { type: 'markdown'; text: string }

export interface PassiveReplyTarget {
  messageId: string
  /** QQ rejects a second Passive reply to the same message with the same number. Starts at 1. */
  sequence: number
}

/** QQ refused the AppID and AppSecret. Trying again with the same pair cannot succeed. */
export class CredentialsRejectedError extends Error {
  override readonly name = 'CredentialsRejectedError'
}
