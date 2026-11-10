/**
 * The only seam between the Channel and QQ. Everything that talks to the QQ
 * Bot API sits behind this interface, so tests run against a fake and the SDK
 * can be swapped without touching the Channel's logic.
 */
export interface QQGateway {
  /** Opens the connection to QQ. */
  connect(): Promise<void>
  /** Closes the connection. Safe to call when not connected. */
  close(): Promise<void>
}
