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
   * Resolves with the ID QQ gave the message.
   *
   * Rejects with {@link SendRefusedError} only when it is certain that QQ did
   * not take the message: QQ answered with an error, or the request never left.
   * Any other rejection means the message may have arrived, for example when
   * the connection broke before QQ's answer came back.
   */
  send(senderId: string, content: OutboundContent, answering?: PassiveReplyTarget): Promise<string>
  /**
   * Shows the bot as typing in a Sender's Direct chat for a while, in answer
   * to one of their messages. It is not a message: QQ returns no ID for it, and
   * it does not use up a Passive reply's sequence number.
   */
  showTyping(senderId: string, messageId: string): Promise<void>
  /**
   * Uploads a file for one Sender's Direct chat and resolves with QQ's
   * reference to it, which a `media` message then sends. Rejects when QQ does
   * not take the file.
   */
  upload(senderId: string, file: OutboundFile): Promise<string>
  /**
   * Fetches an inbound attachment's bytes. Rejects with
   * {@link AttachmentTooLargeError} as soon as more than `maxBytes` arrive,
   * without reading the rest, and rejects when QQ no longer serves the URL.
   */
  download(url: string, maxBytes: number): Promise<Uint8Array>
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
  /** Set when the Sender wrote this as an answer to an earlier message, which QQ sends along. */
  quoted?: { text: string }
  /** What an answer needs in order to quote this message, when QQ supplies it. */
  quoteRef?: QuoteRef
  /** Images and files sent with the message; empty when there are none. */
  attachments: InboundAttachment[]
}

/** A reference to an image or file a Sender sent. The bytes stay with QQ until downloaded. */
export interface InboundAttachment {
  url: string
  /** QQ's label: a MIME type such as `image/jpeg`, or `file`, `voice`. */
  contentType: string
  /** The Sender's file name. QQ replaces an image's name with one of its own. */
  name?: string
  /** Size in bytes, when QQ reports it. */
  size?: number
}

/** What one outbound message carries. QQ renders `markdown` in a Direct chat and shows `text` as written. */
export type OutboundContent =
  | { type: 'text'; text: string; quoting?: QuoteRef }
  | { type: 'markdown'; text: string; quoting?: QuoteRef }
  /** A file uploaded earlier with `upload`, named by the reference QQ returned for it. */
  | { type: 'media'; fileInfo: string }

/**
 * QQ's index for showing a message as quoted by another. It is not the message
 * ID: QQ hands it out with each inbound message, and a message sent with one
 * in `quoting` is displayed in the Direct chat as an answer to that message.
 */
export type QuoteRef = string

/** A local file on its way to a Sender. */
export interface OutboundFile {
  data: Uint8Array
  /** The name the Sender sees for a file. QQ shows an image without one. */
  name: string
  /** `image` is displayed in the conversation; `file` arrives as a download. */
  kind: 'image' | 'file'
}

export interface PassiveReplyTarget {
  messageId: string
  /** QQ rejects a second Passive reply to the same message with the same number. Starts at 1. */
  sequence: number
}

/** QQ refused the AppID and AppSecret. Trying again with the same pair cannot succeed. */
export class CredentialsRejectedError extends Error {
  override readonly name = 'CredentialsRejectedError'
}

/** QQ answered that it did not take a message, or the request never reached it. Sending another form is safe. */
export class SendRefusedError extends Error {
  override readonly name = 'SendRefusedError'
}

/** An attachment turned out larger than the most the caller would take. */
export class AttachmentTooLargeError extends Error {
  override readonly name = 'AttachmentTooLargeError'
}
