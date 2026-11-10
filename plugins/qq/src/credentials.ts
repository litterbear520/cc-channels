import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** What a QQ bot authenticates with. Both come from the QQ open platform console. */
export interface Credentials {
  appId: string
  appSecret: string
}

const APP_ID_KEY = 'QQ_BOT_APP_ID'
const APP_SECRET_KEY = 'QQ_BOT_APP_SECRET'
const CREDENTIAL_KEYS = new Set([APP_ID_KEY, APP_SECRET_KEY])

/** Where the Channel keeps its state. `QQ_STATE_DIR` overrides it, to run a second bot on one machine. */
export function resolveStateDir(): string {
  return process.env.QQ_STATE_DIR || join(homedir(), '.claude', 'channels', 'qq')
}

function credentialsFile(stateDir: string): string {
  return join(stateDir, '.env')
}

function readLines(stateDir: string): string[] {
  try {
    return readFileSync(credentialsFile(stateDir), 'utf8').split('\n')
  } catch {
    return []
  }
}

/** Splits a `KEY=value` line, dropping surrounding whitespace and one pair of quotes around the value. */
function parseLine(line: string): { key: string; value: string } | undefined {
  const match = line.match(/^\s*(\w+)\s*=\s*(.*?)\s*$/)
  return match ? { key: match[1]!, value: match[2]!.replace(/^(["'])(.*)\1$/, '$2') } : undefined
}

/** The lines of the file that are not ours to manage. */
function unrelatedLines(stateDir: string): string[] {
  return readLines(stateDir).filter(
    line => line.trim() !== '' && !CREDENTIAL_KEYS.has(parseLine(line)?.key ?? ''),
  )
}

/** Returns the stored credentials, or undefined unless both the AppID and the AppSecret are set. */
export function readCredentials(stateDir: string): Credentials | undefined {
  try {
    // The file holds a secret: keep it owner-only even if it was created by hand.
    chmodSync(credentialsFile(stateDir), 0o600)
  } catch {}

  const values = new Map<string, string>()
  for (const line of readLines(stateDir)) {
    const parsed = parseLine(line)
    if (parsed) values.set(parsed.key, parsed.value)
  }
  const appId = values.get(APP_ID_KEY)
  const appSecret = values.get(APP_SECRET_KEY)
  return appId && appSecret ? { appId, appSecret } : undefined
}

function writeLines(stateDir: string, lines: string[]): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  // Written under a temporary name first, so the secret never sits in a file others can read.
  const temporary = `${credentialsFile(stateDir)}.tmp`
  writeFileSync(temporary, lines.join('\n') + '\n', { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, credentialsFile(stateDir))
}

/** Stores the credentials, readable by the owner only. Other lines in the file are kept. */
export function saveCredentials(stateDir: string, credentials: Credentials): void {
  writeLines(stateDir, [
    ...unrelatedLines(stateDir),
    `${APP_ID_KEY}=${credentials.appId}`,
    `${APP_SECRET_KEY}=${credentials.appSecret}`,
  ])
}

/** Removes the stored credentials. The file goes too, unless it holds other lines. */
export function clearCredentials(stateDir: string): void {
  const others = unrelatedLines(stateDir)
  if (others.length > 0) writeLines(stateDir, others)
  else rmSync(credentialsFile(stateDir), { force: true })
}
