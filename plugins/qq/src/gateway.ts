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
   * `onLost` is called if, after that, the connection ends for good: QQ has
   * shut the bot out, or has stopped accepting the credentials. Drops that the
   * gateway recovers from are not reported.
   */
  connect(credentials: Credentials, onLost: (error: Error) => void): Promise<void>
  /** Closes the connection. Safe to call when not connected. */
  close(): Promise<void>
}

/** QQ refused the AppID and AppSecret. Trying again with the same pair cannot succeed. */
export class CredentialsRejectedError extends Error {
  override readonly name = 'CredentialsRejectedError'
}
