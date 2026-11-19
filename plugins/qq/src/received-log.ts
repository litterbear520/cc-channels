import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeOwnerOnly } from './owner-only-file.ts'

/** The file of messages the Channel passed on, one JSON object per line. */
export const receivedLogFile = (stateDir: string) => join(stateDir, 'received.jsonl')

/** How long a line stays in the received log. */
export const RECEIVED_LOG_DAYS = 7
const KEEP_MS = RECEIVED_LOG_DAYS * 24 * 60 * 60 * 1000

/**
 * One line of the received log. The names match the attributes of the
 * Channel event, so that a program reading the log can rebuild the event.
 */
export interface ReceivedEntry {
  message_id: string
  chat_id: string
  sender_id: string
  /** When the Sender wrote it, as QQ reports it (ISO 8601). */
  ts: string
  /** The text of the Channel event. */
  text: string
  /** The names of the attachments, as the Channel event lists them. */
  attachments: string[]
}

/**
 * A record, outside the Claude Code session, of every message the Channel
 * passed on. When the session is replaced before it handled a message, a
 * program on the same machine can still find the message here.
 */
export interface ReceivedLog {
  /** Adds one line. Throws when the line could not be written. */
  append(entry: ReceivedEntry): void
  /** Removes the lines older than {@link RECEIVED_LOG_DAYS} days, and any line that cannot be read. */
  prune(): void
}

export function createReceivedLog({ stateDir, now }: { stateDir: string; now: () => number }): ReceivedLog {
  const path = receivedLogFile(stateDir)
  return {
    append(entry) {
      appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    },

    prune() {
      let lines: string[]
      try {
        lines = readFileSync(path, 'utf8').split('\n')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      const oldest = now() - KEEP_MS
      const kept = lines.filter(line => {
        try {
          const written = Date.parse((JSON.parse(line) as { ts?: unknown }).ts as string)
          return written >= oldest
        } catch {
          // An empty line, or one a crash cut short.
          return false
        }
      })
      // Rewritten even when nothing was removed, which also makes a file created by hand owner-only.
      writeOwnerOnly(path, kept.map(line => `${line}\n`).join(''))
    },
  }
}
