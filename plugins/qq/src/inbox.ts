import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AttachmentTooLargeError, type InboundAttachment, type QQGateway } from './gateway.ts'

/**
 * QQ has no API to fetch a past message, so the attachment references of this
 * many recent messages are kept in memory, to be downloaded when Claude asks.
 */
const REMEMBERED_MESSAGES = 200
/**
 * The largest attachment the Channel downloads, the same limit as the official
 * discord plugin. The download stops as soon as more arrives, so no more than
 * this is fetched or held in memory for one attachment.
 */
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
/** In UTF-8 bytes: file systems limit a name to 255, and the Channel adds a prefix. */
const MAX_FILE_NAME_BYTES = 200

/** The directory downloaded attachments are saved in. The only part of the state directory Claude may send from. */
export const inboxDir = (stateDir: string) => join(stateDir, 'inbox')

export interface Inbox {
  /**
   * Keeps the attachment references of a message that arrived in a chat, for
   * a later download: its own, then those of the message it quoted.
   */
  remember(chatId: string, messageId: string, attachments: InboundAttachment[]): void
  /**
   * Downloads the attachments of a remembered message of this chat into the
   * inbox directory. Returns the local paths of those saved, and why each of
   * the others was not; rejects when none was saved.
   */
  download(chatId: string, messageId: string): Promise<{ paths: string[]; failures: string[] }>
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
  const remembered = new Map<string, { chatId: string; attachments: InboundAttachment[] }>()

  return {
    remember(chatId, messageId, attachments) {
      if (attachments.length === 0) return
      remembered.set(messageId, { chatId, attachments })
      // A Map iterates in insertion order, so this forgets the oldest.
      if (remembered.size > REMEMBERED_MESSAGES) remembered.delete(remembered.keys().next().value!)
    },

    async download(chatId, messageId) {
      const message = remembered.get(messageId)
      // A message of another chat is reported the same way, so that its existence is not revealed.
      if (!message || message.chatId !== chatId) {
        throw new Error(
          `the Channel no longer remembers attachments for message ${messageId}. QQ cannot be asked for a past ` +
            `message, so the references of the last ${REMEMBERED_MESSAGES} messages with attachments are kept in ` +
            'memory and are lost on a restart. Ask the Sender to send it again.',
        )
      }
      const dir = inboxDir(stateDir)
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      // The random part keeps downloads in the same millisecond apart, of one message or of two.
      const prefix = `${now()}-${randomBytes(4).toString('hex')}`
      const paths: string[] = []
      // One that fails leaves the others to download: a quoted message's address, being older, is likelier to have expired.
      const failures: string[] = []
      for (const [index, attachment] of message.attachments.entries()) {
        const name = safeFileName(attachment.name)
        try {
          paths.push(await save(attachment, join(dir, `${prefix}-${index + 1}-${name}`), name))
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error))
        }
      }
      if (paths.length === 0) throw new Error(failures.join('; '))
      return { paths, failures }
    },
  }

  async function save(attachment: InboundAttachment, path: string, name: string): Promise<string> {
    // QQ's figure saves a download that would be refused; the gateway counts the bytes, as QQ does not always give one.
    if ((attachment.size ?? 0) > MAX_DOWNLOAD_BYTES) throw tooLarge(name)
    let bytes: Uint8Array
    try {
      bytes = await gateway.download(attachment.url, MAX_DOWNLOAD_BYTES)
    } catch (error) {
      throw error instanceof AttachmentTooLargeError ? tooLarge(name) : new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw tooLarge(name)
    // The prefix keeps two attachments with one name apart; the name itself can no longer leave the directory.
    // `wx` fails rather than overwrite a file another download returned.
    writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' })
    chmodSync(path, 0o600)
    return path
  }
}

const tooLarge = (name: string) =>
  new Error(`${name} is over 25 MB, the most the Channel downloads; ask the Sender for another way to get it`)

/**
 * A file name with nothing in it that a file system gives meaning to: no
 * directory part, no leading dot, and only letters, digits, `.`, `_` and `-`.
 */
export function safeFileName(name: string | undefined): string {
  const lastPart = (name ?? '').split(/[\\/]/).at(-1)!
  let safe = lastPart.replace(/[^\p{L}\p{N}._-]/gu, '_')
  // Cut from the front, a whole character at a time, so that the extension at the end is kept.
  while (Buffer.byteLength(safe) > MAX_FILE_NAME_BYTES) safe = [...safe].slice(1).join('')
  // Dots are stripped after the cut, which can expose new ones.
  safe = safe.replace(/^\.+/, '')
  return safe || 'attachment'
}

/**
 * The two meta values that tell Claude what a message carries, without
 * downloading anything. Those of the message it quoted come last, marked
 * `quoted:`, in the order download_attachment saves them.
 */
export function describeAttachments(
  own: InboundAttachment[],
  quoted: InboundAttachment[] = [],
): { attachment_count: string; attachments: string } {
  const describe = (attachment: InboundAttachment) => {
    const size = attachment.size === undefined ? '' : `, ${Math.max(1, Math.round(attachment.size / 1024))}KB`
    // The name is the Sender's text; the safe form keeps it from breaking out of the tag.
    return `${safeFileName(attachment.name)} (${attachment.contentType.replace(/[^\w/.+-]/g, '_')}${size})`
  }
  return {
    attachment_count: String(own.length + quoted.length),
    attachments: [...own.map(describe), ...quoted.map(attachment => `quoted: ${describe(attachment)}`)].join('; '),
  }
}

/**
 * How an attachment of a quoted message reads inside the block quote, as the
 * SDK's `quoteRef` middleware writes it: `[image]`, or `[file: report.pdf]`.
 */
export function attachmentPlaceholder(attachment: InboundAttachment): string {
  const type = attachment.contentType.toLowerCase()
  const kind = type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') || type === 'voice' ? 'voice' : 'file'
  // QQ replaces an image's name with one of its own, which tells Claude nothing.
  return kind === 'image' || kind === 'voice' || !attachment.name ? `[${kind}]` : `[${kind}: ${safeFileName(attachment.name)}]`
}
