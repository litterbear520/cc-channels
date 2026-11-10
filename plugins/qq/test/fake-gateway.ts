import type { QQGateway } from '../src/gateway.ts'

/** In-memory QQ gateway. Tests drive the Channel through it instead of a real bot. */
export class FakeQQGateway implements QQGateway {
  connected = false

  async connect(): Promise<void> {
    this.connected = true
  }

  async close(): Promise<void> {
    this.connected = false
  }
}
