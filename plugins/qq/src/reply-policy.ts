import type { OutboundContent, QQGateway } from './gateway.ts'

/**
 * QQ's documented limits on Passive replies in a Direct chat. The live check
 * reached neither for the bot's creator; they are kept as conservative
 * constants for Senders who may be held to them.
 */
export const PASSIVE_REPLY_WINDOW_MS = 60 * 60 * 1000
export const PASSIVE_REPLIES_PER_MESSAGE = 4

/** Senders whose latest message is remembered. Unknown Senders are among them, so it is bounded. */
const REMEMBERED_SENDERS = 1000

interface LatestInbound {
  messageId: string
  arrivedAt: number
  /** Passive replies tried against the message. QQ rejects a reused sequence number, so each try takes a new one. */
  attempts: number
  /** Passive replies QQ accepted. */
  delivered: number
}

export interface ReplyPolicy {
  /** Records that a Sender wrote. Their next messages are answered as Passive replies to this one. */
  noteInbound(senderId: string, messageId: string): void
  /**
   * Sends one message to a Sender and resolves with its ID. `forms` holds the
   * same message in order of preference, such as Markdown and then plain text.
   *
   * While QQ's window and count allow, it is a Passive reply to the Sender's
   * latest message; if QQ rejects every form, the last form is sent once as a
   * Proactive message. Otherwise each form is tried as a Proactive message.
   * Rejects with every refusal named when nothing got through. Nothing is
   * queued or tried again later.
   */
  deliver(senderId: string, forms: OutboundContent[]): Promise<string>
}

export function createReplyPolicy({ gateway, now }: { gateway: QQGateway; now: () => number }): ReplyPolicy {
  const latest = new Map<string, LatestInbound>()

  return {
    noteInbound(senderId, messageId) {
      // Deleted first so that the Sender moves to the end, which is the newest.
      latest.delete(senderId)
      latest.set(senderId, { messageId, arrivedAt: now(), attempts: 0, delivered: 0 })
      if (latest.size > REMEMBERED_SENDERS) latest.delete(latest.keys().next().value!)
    },

    async deliver(senderId, forms) {
      const refusals: string[] = []
      const attempt = async (content: OutboundContent, answering?: LatestInbound): Promise<string | undefined> => {
        const mode = answering ? 'Passive reply' : 'Proactive message'
        try {
          const target = answering && { messageId: answering.messageId, sequence: ++answering.attempts }
          const id = await gateway.send(senderId, content, target)
          if (answering) answering.delivered++
          return id
        } catch (error) {
          refusals.push(`${mode} as ${content.type}: ${error instanceof Error ? error.message : String(error)}`)
          return undefined
        }
      }

      const inbound = latest.get(senderId)
      const passive =
        inbound &&
        now() - inbound.arrivedAt < PASSIVE_REPLY_WINDOW_MS &&
        inbound.delivered < PASSIVE_REPLIES_PER_MESSAGE
      // After a rejected Passive reply only the last form, the plainest, is tried as a Proactive message.
      const attempts: [OutboundContent, LatestInbound?][] = passive
        ? [...forms.map(form => [form, inbound] as [OutboundContent, LatestInbound]), [forms.at(-1)!]]
        : forms.map(form => [form])
      for (const [content, answering] of attempts) {
        const id = await attempt(content, answering)
        if (id !== undefined) return id
      }
      throw new Error(`QQ did not accept the message (${refusals.join('; ')})`)
    },
  }
}
