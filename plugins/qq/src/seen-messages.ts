import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeOwnerOnly } from './owner-only-file.ts'

/** The file that keeps the IDs of recent inbound messages across restarts. */
export const seenMessagesFile = (stateDir: string) => join(stateDir, 'recent-message-ids.json')

/**
 * QQ delivers a message again after a reconnect, and after a restart that
 * resumed the gateway session. This many recent message IDs are kept to spot
 * it.
 */
export const REMEMBERED_MESSAGE_IDS = 1000

export interface SeenMessages {
  /** True the first time a message ID is seen, here or before the last restart. */
  isNew(messageId: string): boolean
  /** Forgets a message ID, so that the message is taken when QQ delivers it again. */
  forget(messageId: string): void
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createSeenMessages({ stateDir, log }: { stateDir: string; log: (line: string) => void }): SeenMessages {
  const path = seenMessagesFile(stateDir)
  const seen = new Set<string>(read())
  let saveFailing = false

  function read(): string[] {
    try {
      const ids: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === 'string').slice(-REMEMBERED_MESSAGE_IDS)
      log(`${path} does not hold a list of message IDs; starting without one`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log(`could not read the recent message IDs, so a message QQ delivers again may be passed on twice: ${errorText(error)}`)
      }
    }
    return []
  }

  function save(): void {
    try {
      writeOwnerOnly(path, `${JSON.stringify([...seen])}\n`)
      saveFailing = false
    } catch (error) {
      // Logged once until a save works again: one line per message would bury the log.
      if (!saveFailing) {
        log(`could not save the recent message IDs, so after a restart a message may be passed on twice: ${errorText(error)}`)
      }
      saveFailing = true
    }
  }

  return {
    isNew(messageId) {
      if (seen.has(messageId)) return false
      seen.add(messageId)
      // A Set iterates in insertion order, so this forgets the oldest.
      if (seen.size > REMEMBERED_MESSAGE_IDS) seen.delete(seen.values().next().value!)
      save()
      return true
    },
    forget(messageId) {
      if (seen.delete(messageId)) save()
    },
  }
}
