import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { GatewaySession, GatewaySessionStore } from './gateway.ts'
import { writeOwnerOnly } from './owner-only-file.ts'

/** The file that keeps the gateway session across restarts. */
export const sessionFile = (stateDir: string) => join(stateDir, 'session.json')

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Keeps the gateway session in the state directory, so that a restarted
 * Channel resumes it and QQ delivers the messages that arrived in between.
 *
 * The file names the AppID it belongs to: a gateway session of another bot,
 * left behind when the credentials were changed, is not resumed.
 */
export function createSessionFile({
  stateDir,
  appId,
  log,
}: {
  stateDir: string
  appId: string
  log: (line: string) => void
}): GatewaySessionStore {
  const path = sessionFile(stateDir)
  // The gateway saves after every event, so a lasting failure is logged once until a save works again.
  let saveFailing = false

  return {
    load() {
      let saved: { appId?: unknown; sessionId?: unknown; lastSeq?: unknown }
      try {
        saved = JSON.parse(readFileSync(path, 'utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          log(`could not read the saved gateway session, so a new one is started: ${errorText(error)}`)
        }
        return null
      }
      if (saved?.appId !== appId || typeof saved.sessionId !== 'string' || saved.sessionId === '') return null
      return { sessionId: saved.sessionId, lastSeq: typeof saved.lastSeq === 'number' ? saved.lastSeq : null }
    },

    save(session: GatewaySession) {
      try {
        writeOwnerOnly(path, `${JSON.stringify({ appId, sessionId: session.sessionId, lastSeq: session.lastSeq })}\n`)
        saveFailing = false
      } catch (error) {
        if (!saveFailing) {
          log(`could not save the gateway session, so a restart will start a new one: ${errorText(error)}`)
        }
        saveFailing = true
      }
    },

    clear() {
      try {
        rmSync(path, { force: true })
      } catch (error) {
        log(`could not remove the gateway session QQ no longer takes back: ${errorText(error)}`)
      }
    },
  }
}
