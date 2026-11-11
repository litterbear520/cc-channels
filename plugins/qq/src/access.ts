import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Who may reach the session: the allowlist, the access policy, and the Pairing
 * codes waiting for approval. Kept in `access.json` in the state directory,
 * which the Channel and the access skill both read and write.
 */

export const ACCESS_POLICIES = ['pairing', 'allowlist', 'disabled'] as const
/**
 * - `pairing`: unknown Senders are answered with a Pairing code.
 * - `allowlist`: unknown Senders are ignored.
 * - `disabled`: every Sender is ignored.
 */
export type AccessPolicy = (typeof ACCESS_POLICIES)[number]

export interface PendingPairing {
  senderId: string
  expiresAt: number
  /** How many times the Sender has been told the code. */
  replies: number
}

export interface Access {
  policy: AccessPolicy
  /** Sender IDs that may reach the session. */
  allowFrom: string[]
  /** Pairing codes waiting for approval, keyed by code. */
  pending: Record<string, PendingPairing>
}

/** What to do with one inbound message. */
export type Decision =
  | { action: 'deliver' }
  | { action: 'drop' }
  /** Answer with the Pairing code. `reminder` is set when the Sender was already told it. */
  | { action: 'pair'; code: string; reminder: boolean }

export const PAIRING_CODE_LIFETIME_MS = 60 * 60 * 1000
const MAX_PENDING_PAIRINGS = 3
/** The first answer plus one reminder; after that the Sender hears nothing until the code expires. */
const MAX_REPLIES_PER_PAIRING = 2
/** A Sender ID becomes a file name in the approved directory, so anything else is refused. */
const SAFE_SENDER_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * How long a writer waits for another to finish before giving up. Writers hold
 * the lock only while they read, change and save the file, for milliseconds.
 */
const LOCK_WAIT_MS = 2000
const LOCK_RETRY_MS = 10

const accessFile = (stateDir: string) => join(stateDir, 'access.json')
/** Held by whichever process is changing the access file, and holding its ID. */
const lockFile = (stateDir: string) => join(stateDir, 'access.lock')
const approvedDir = (stateDir: string) => join(stateDir, 'approved')

export const newPairingCode = () => randomBytes(3).toString('hex')

export function readAccess(stateDir: string): Access {
  let raw: string
  try {
    raw = readFileSync(accessFile(stateDir), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { policy: 'pairing', allowFrom: [], pending: {} }
    throw error
  }
  // A file that cannot be understood is an error, never the defaults: falling
  // back to `pairing` would reopen a Channel its user had closed.
  const parsed = JSON.parse(raw) as Partial<Access> | null
  if (!parsed || typeof parsed !== 'object') throw new Error('access.json does not hold an object')
  const policy = parsed.policy ?? 'pairing'
  if (!ACCESS_POLICIES.includes(policy)) throw new Error(`access.json has an unknown policy "${policy}"`)
  const pending: Access['pending'] = {}
  for (const [code, pairing] of Object.entries(parsed.pending ?? {})) {
    const { senderId, expiresAt, replies } = (pairing ?? {}) as Partial<PendingPairing>
    if (typeof senderId !== 'string' || !SAFE_SENDER_ID.test(senderId) || typeof expiresAt !== 'number') continue
    pending[code] = { senderId, expiresAt, replies: typeof replies === 'number' ? replies : 1 }
  }
  return {
    policy,
    allowFrom: Array.isArray(parsed.allowFrom) ? parsed.allowFrom.filter(id => typeof id === 'string') : [],
    pending,
  }
}

function saveAccess(stateDir: string, access: Access): void {
  const file = accessFile(stateDir)
  // Written whole and renamed, so a reader never sees half a file. The name is
  // the writer's own, so that no other writer can rename it half written.
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(access, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    renameSync(temporary, file)
  } finally {
    rmSync(temporary, { force: true })
  }
}

/** True when no process has this ID. A process of another user still counts as running. */
function isGone(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

/**
 * Removes a lock left by a process that ended while holding it. Only one
 * process at a time may do so, so that none removes a lock another has just
 * taken. Returns true when the lock is gone and worth trying again.
 */
function breakAbandonedLock(stateDir: string): boolean {
  const lock = lockFile(stateDir)
  const breaker = `${lock}.break`
  try {
    writeFileSync(breaker, String(process.pid), { flag: 'wx', mode: 0o600 })
  } catch {
    return false
  }
  try {
    if (!isGone(Number(readFileSync(lock, 'utf8')))) return false
    rmSync(lock, { force: true })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  } finally {
    rmSync(breaker, { force: true })
  }
}

/**
 * Runs `work` while this process alone may change the access file. The
 * Channel and the access command are separate processes, so without this one
 * could save a copy read before the other's change and undo it. Throws, never
 * taking the lock by force, when another running process holds it too long.
 */
function withLock<Result>(stateDir: string, work: () => Result): Result {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const lock = lockFile(stateDir)
  const giveUpAt = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    if (breakAbandonedLock(stateDir)) continue
    if (Date.now() >= giveUpAt) {
      throw new Error(
        `another process has been changing access.json for over ${LOCK_WAIT_MS / 1000} seconds; try again. ` +
          `If no Claude Code session or access command is running, delete ${lock}`,
      )
    }
    Bun.sleepSync(LOCK_RETRY_MS)
  }
  try {
    return work()
  } finally {
    rmSync(lock, { force: true })
  }
}

/**
 * Reads the access file, forgets expired Pairings, and applies `change`, which
 * returns its result and whether it altered anything. Writes the file back
 * only when something changed. All of it happens under the lock.
 */
function update<Result>(stateDir: string, now: number, change: (access: Access) => [result: Result, changed: boolean]): Result {
  return withLock(stateDir, () => updateLocked(stateDir, now, change))
}

function updateLocked<Result>(stateDir: string, now: number, change: (access: Access) => [result: Result, changed: boolean]): Result {
  const access = readAccess(stateDir)
  let expired = false
  for (const [code, pairing] of Object.entries(access.pending)) {
    if (pairing.expiresAt <= now) {
      delete access.pending[code]
      expired = true
    }
  }
  const [result, changed] = change(access)
  if (changed || expired) saveAccess(stateDir, access)
  return result
}

/**
 * Decides what happens to a message from this Sender. Under the pairing
 * policy this issues a Pairing code, or counts a reminder, for an unknown one.
 */
export function decide(stateDir: string, senderId: string, now: number, makeCode: () => string): Decision {
  return update<Decision>(stateDir, now, access => {
    if (access.policy === 'disabled' || !SAFE_SENDER_ID.test(senderId)) return [{ action: 'drop' }, false]
    if (access.allowFrom.includes(senderId)) return [{ action: 'deliver' }, false]
    if (access.policy === 'allowlist') return [{ action: 'drop' }, false]

    const waiting = Object.entries(access.pending).find(([, pairing]) => pairing.senderId === senderId)
    if (waiting) {
      const [code, pairing] = waiting
      if (pairing.replies >= MAX_REPLIES_PER_PAIRING) return [{ action: 'drop' }, false]
      pairing.replies++
      return [{ action: 'pair', code, reminder: true }, true]
    }
    if (Object.keys(access.pending).length >= MAX_PENDING_PAIRINGS) return [{ action: 'drop' }, false]

    const code = makeCode()
    access.pending[code] = { senderId, expiresAt: now + PAIRING_CODE_LIFETIME_MS, replies: 1 }
    return [{ action: 'pair', code, reminder: false }, true]
  })
}

/**
 * True when Claude may write to the Sender or fetch what they sent: they are
 * on the allowlist and the policy is not `disabled`.
 */
export function mayReach(stateDir: string, senderId: string): boolean {
  const access = readAccess(stateDir)
  return access.policy !== 'disabled' && access.allowFrom.includes(senderId)
}

/**
 * Approves a pending Pairing: the Sender joins the allowlist, and a marker is
 * left for the Channel, which sends the confirmation. Returns the Sender ID,
 * or undefined when no Pairing with that code is pending (it may have expired).
 */
export function approvePairing(stateDir: string, code: string, now: number): string | undefined {
  const senderId = update<string | undefined>(stateDir, now, access => {
    // Object.hasOwn: a code such as "constructor" must not find an inherited property.
    if (!Object.hasOwn(access.pending, code)) return [undefined, false]
    const { senderId } = access.pending[code]!
    delete access.pending[code]
    if (!access.allowFrom.includes(senderId)) access.allowFrom.push(senderId)
    return [senderId, true]
  })
  if (senderId) {
    mkdirSync(approvedDir(stateDir), { recursive: true, mode: 0o700 })
    writeFileSync(join(approvedDir(stateDir), senderId), '', { mode: 0o600 })
  }
  return senderId
}

/** Discards a pending Pairing. Returns false when no Pairing with that code is pending. */
export function denyPairing(stateDir: string, code: string, now: number): boolean {
  return update(stateDir, now, access => {
    const found = Object.hasOwn(access.pending, code)
    delete access.pending[code]
    return [found, found]
  })
}

/** Takes a Sender off the allowlist. Returns false when the Sender was not on it. */
export function removeSender(stateDir: string, senderId: string, now: number): boolean {
  return update(stateDir, now, access => {
    const found = access.allowFrom.includes(senderId)
    access.allowFrom = access.allowFrom.filter(id => id !== senderId)
    return [found, found]
  })
}

export function setPolicy(stateDir: string, policy: AccessPolicy, now: number): void {
  update(stateDir, now, access => {
    access.policy = policy
    return [undefined, true]
  })
}

/**
 * Returns the Senders approved since the last call and clears their markers,
 * so that each approval is confirmed once.
 */
export function takeApprovedSenders(stateDir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(approvedDir(stateDir))
  } catch {
    return []
  }
  for (const name of names) rmSync(join(approvedDir(stateDir), name), { force: true })
  return names.filter(name => SAFE_SENDER_ID.test(name))
}
