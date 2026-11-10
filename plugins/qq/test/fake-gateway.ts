import type { Credentials } from '../src/credentials.ts'
import type { QQGateway } from '../src/gateway.ts'

/** In-memory QQ gateway. Tests drive the Channel through it instead of a real bot. */
export class FakeQQGateway implements QQGateway {
  /** The credentials of the live connection, or undefined when not connected. */
  connectedWith: Credentials | undefined
  connectAttempts = 0
  /** Set to make QQ refuse the next connection. */
  failNextConnectWith: Error | undefined

  private onLost: ((error: Error) => void) | undefined

  async connect(credentials: Credentials, onLost: (error: Error) => void): Promise<void> {
    this.connectAttempts++
    const failure = this.failNextConnectWith
    if (failure) {
      this.failNextConnectWith = undefined
      throw failure
    }
    this.connectedWith = credentials
    this.onLost = onLost
  }

  /** Ends the live connection for good, as when QQ bans the bot. */
  loseConnection(error: Error): void {
    this.connectedWith = undefined
    this.onLost?.(error)
  }

  async close(): Promise<void> {
    this.connectedWith = undefined
  }
}
