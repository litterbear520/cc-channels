import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { InboundAttachment, InboundMessage, QQGateway } from './gateway.ts'

/**
 * QQ has no API to fetch a past message, so the attachment references of this
 * many recent messages are kept in memory, to be downloaded when Claude asks.
 */
const REMEMBERED_MESSAGES = 200
const MAX_FILE_NAME_LENGTH = 100

/** The directory downloaded attachments are saved in. The only part of the state directory Claude may send from. */
export const inboxDir = (stateDir: string) => join(stateDir, 'inbox')

export interface Inbox {
  /** Keeps a message's attachment references for a later download. */
  remember(message: InboundMessage): void
  /**
   * Downloads the attachments of a remembered message from this Sender into
   * the inbox directory and returns their local paths.
   */
  download(senderId: string, messageId: string): Promise<string[]>
}

export function createInbox({
  gateway,
  stateDir,
  now,
}: {
  gateway: QQGateway
  stateDir: string
  now: () => number
}): Inbox {
  const remembered = new Map<string, { senderId: string; attachments: InboundAttachment[] }>()

  return {
    remember(message) {
      if (message.attachments.length === 0) return
      remembered.set(message.messageId, { senderId: message.senderId, attachments: message.attachments })
      // A Map iterates in insertion order, so this forgets the oldest.
      if (remembered.size > REMEMBERED_MESSAGES) remembered.delete(remembered.keys().next().value!)
    },

    async download(senderId, messageId) {
      const message = remembered.get(messageId)
      // A message from another Sender is reported the same way, so that its existence is not revealed.
      if (!message || message.senderId !== senderId) {
        throw new Error(
          `the Channel no longer remembers attachments for message ${messageId}. QQ cannot be asked for a past ` +
            `message, so the references of the last ${REMEMBERED_MESSAGES} messages with attachments are kept in ` +
            'memory and are lost on a restart. Ask the Sender to send it again.',
        )
      }
      const dir = inboxDir(stateDir)
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const stamp = now()
      const paths: string[] = []
      for (const [index, attachment] of message.attachments.entries()) {
        const bytes = await gateway.download(attachment.url)
        // The prefix keeps two attachments with one name apart; the name itself can no longer leave the directory.
        const path = join(dir, `${stamp}-${index + 1}-${safeFileName(attachment.name)}`)
        writeFileSync(path, bytes, { mode: 0o600 })
        chmodSync(path, 0o600)
        paths.push(path)
      }
      return paths
    },
  }
}

/**
 * A file name with nothing in it that a file system gives meaning to: no
 * directory part, no leading dot, and only letters, digits, `.`, `_` and `-`.
 */
export function safeFileName(name: string | undefined): string {
  const lastPart = (name ?? '').split(/[\\/]/).at(-1)!
  const safe = lastPart
    .replace(/[^\p{L}\p{N}._-]/gu, '_')
    .replace(/^\.+/, '')
    .slice(-MAX_FILE_NAME_LENGTH)
  return safe || 'attachment'
}

/** The two meta values that tell Claude what a message carries, without downloading anything. */
export function describeAttachments(attachments: InboundAttachment[]): { attachment_count: string; attachments: string } {
  return {
    attachment_count: String(attachments.length),
    attachments: attachments
      .map(attachment => {
        const size = attachment.size === undefined ? '' : `, ${Math.max(1, Math.round(attachment.size / 1024))}KB`
        // The name is the Sender's text; the safe form keeps it from breaking out of the tag.
        return `${safeFileName(attachment.name)} (${attachment.contentType.replace(/[^\w/.+-]/g, '_')}${size})`
      })
      .join('; '),
  }
}
