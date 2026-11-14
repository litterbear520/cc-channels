import { groupIdOf } from './chat-id.ts'
import { SendRefusedError, type OutboundContent, type QQGateway } from './gateway.ts'

/**
 * QQ's documented limits on Passive replies in a Direct chat. The live check
 * reached neither for the bot's creator; they are kept as conservative
 * constants for Senders who may be held to them.
 */
export const PASSIVE_REPLY_WINDOW_MS = 60 * 60 * 1000
export const PASSIVE_REPLIES_PER_MESSAGE = 4
/** QQ's documented limits in a Group chat, which are much tighter. Not reached in the live check either. */
export const GROUP_PASSIVE_REPLY_WINDOW_MS = 5 * 60 * 1000
export const GROUP_PASSIVE_REPLIES_PER_MESSAGE = 5

const limitsOf = (chatId: string) =>
  groupIdOf(chatId) === undefined
    ? { windowMs: PASSIVE_REPLY_WINDOW_MS, replies: PASSIVE_REPLIES_PER_MESSAGE }
    : { windowMs: GROUP_PASSIVE_REPLY_WINDOW_MS, replies: GROUP_PASSIVE_REPLIES_PER_MESSAGE }

/** Chats whose latest message is remembered. Unknown Senders' are among them, so it is bounded. */
const REMEMBERED_CHATS = 1000

interface LatestInbound {
  messageId: string
  arrivedAt: number
  /** Passive replies tried against the message. QQ rejects a reused sequence number, so each try takes a new one. */
  attempts: number
  /**
   * Passive replies counted against QQ's limit: those QQ accepted, those still
   * on their way, and those whose outcome is unknown. A slot is taken before
   * sending, so that messages sent at the same time cannot all take the last one.
   */
  used: number
}

/**
 * The connection failed in a way that leaves open whether QQ took the message.
 * It is not sent again, in any form, so that the Sender never gets it twice.
 */
export class DeliveryUnknownError extends Error {
  override readonly name = 'DeliveryUnknownError'
}

export interface ReplyPolicy {
  /** Records that a message arrived in a chat. The next messages to that chat are Passive replies to this one. */
  noteInbound(chatId: string, messageId: string): void
  /**
   * Sends one message to a chat and resolves with its ID. `forms` holds the
   * same message in order of preference, such as Markdown and then plain text.
   *
   * While QQ's window and count allow, it is a Passive reply to the chat's
   * latest message; if QQ refuses every form, the last form is sent once as a
   * Proactive message. Otherwise each form is tried as a Proactive message.
   * Only a refusal ({@link SendRefusedError}) moves on to the next try.
   *
   * Rejects with every refusal named when nothing got through, and with
   * {@link DeliveryUnknownError}, without trying anything more, when QQ may
   * have taken a try. Nothing is queued or tried again later.
   */
  deliver(chatId: string, forms: OutboundContent[]): Promise<string>
}

export function createReplyPolicy({ gateway, now }: { gateway: QQGateway; now: () => number }): ReplyPolicy {
  const latest = new Map<string, LatestInbound>()

  return {
    noteInbound(chatId, messageId) {
      // Deleted first so that the chat moves to the end, which is the newest.
      latest.delete(chatId)
      latest.set(chatId, { messageId, arrivedAt: now(), attempts: 0, used: 0 })
      if (latest.size > REMEMBERED_CHATS) latest.delete(latest.keys().next().value!)
    },

    async deliver(chatId, forms) {
      const refusals: string[] = []
      /** Resolves with the message ID, or with undefined when QQ refused it. */
      const attempt = async (content: OutboundContent, answering?: LatestInbound): Promise<string | undefined> => {
        const mode = answering ? 'Passive reply' : 'Proactive message'
        try {
          const target = answering && { messageId: answering.messageId, sequence: ++answering.attempts }
          return await gateway.send(chatId, content, target)
        } catch (error) {
          const reason = `${mode} as ${content.type}: ${error instanceof Error ? error.message : String(error)}`
          if (!(error instanceof SendRefusedError)) {
            const before = refusals.length > 0 ? `, after ${refusals.join('; ')}` : ''
            throw new DeliveryUnknownError(`QQ may or may not have taken the message (${reason}${before})`)
          }
          refusals.push(reason)
          return undefined
        }
      }

      const inbound = latest.get(chatId)
      const limits = limitsOf(chatId)
      const passive =
        inbound && now() - inbound.arrivedAt < limits.windowMs && inbound.used < limits.replies ? inbound : undefined
      if (passive) {
        // Taken before anything is awaited; given back only when QQ refused every form.
        passive.used++
        for (const form of forms) {
          const id = await attempt(form, passive)
          if (id !== undefined) return id
        }
        passive.used--
      }
      // After a refused Passive reply only the last form, the plainest, is tried as a Proactive message.
      for (const form of passive ? [forms.at(-1)!] : forms) {
        const id = await attempt(form)
        if (id !== undefined) return id
      }
      throw new Error(`QQ did not accept the message (${refusals.join('; ')})`)
    },
  }
}
