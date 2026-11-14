import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { groupChatId, groupIdOf } from './chat-id.ts'

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
  /** Set when the code is for a Group chat: approving it registers the group, and the Sender is who asked. */
  groupId?: string
  expiresAt: number
  /** How many times the Sender has been told the code. */
  replies: number
}

export const GROUP_MEMBERS = ['allowlist', 'everyone'] as const
/** How one registered Group chat is served. */
export interface GroupAccess {
  /** When true, only a message that mentions the bot with an @ reaches the session. */
  requireMention: boolean
  /**
   * - `allowlist`: only Senders on the allowlist are heard in the group.
   * - `everyone`: any member of the group is heard.
   */
  members: (typeof GROUP_MEMBERS)[number]
}

export interface Access {
  policy: AccessPolicy
  /** Sender IDs that may reach the session. */
  allowFrom: string[]
  /** The Group chats the bot answers in, keyed by QQ's ID for the group. */
  groups: Record<string, GroupAccess>
  /** Pairing codes waiting for approval, keyed by code. */
  pending: Record<string, PendingPairing>
}

/** Where an inbound message comes from. */
export interface Origin {
  senderId: string
  /** Set when it was written in a Group chat. */
  group?: { id: string; mentionsBot: boolean }
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
/** A Sender ID or group ID becomes a file name in the approved directory, so anything else is refused. */
const SAFE_SENDER_ID = /^[A-Za-z0-9_-]{1,128}$/
/** An approved group's marker is named with this in front. No ID contains a dot. */
const GROUP_MARKER_PREFIX = 'group.'

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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { policy: 'pairing', allowFrom: [], groups: {}, pending: {} }
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
    const { senderId, groupId, expiresAt, replies } = (pairing ?? {}) as Partial<PendingPairing>
    if (typeof senderId !== 'string' || !SAFE_SENDER_ID.test(senderId) || typeof expiresAt !== 'number') continue
    if (groupId !== undefined && (typeof groupId !== 'string' || !SAFE_SENDER_ID.test(groupId))) continue
    pending[code] = { senderId, ...(groupId ? { groupId } : {}), expiresAt, replies: typeof replies === 'number' ? replies : 1 }
  }
  const groups: Access['groups'] = {}
  for (const [groupId, group] of Object.entries(parsed.groups ?? {})) {
    if (!SAFE_SENDER_ID.test(groupId)) continue
    const { requireMention, members } = (group ?? {}) as Partial<GroupAccess>
    // Anything unreadable falls back to the narrower setting, never the wider one.
    groups[groupId] = { requireMention: requireMention !== false, members: members === 'everyone' ? 'everyone' : 'allowlist' }
  }
  return {
    policy,
    allowFrom: Array.isArray(parsed.allowFrom) ? parsed.allowFrom.filter(id => typeof id === 'string') : [],
    groups,
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
 * Decides what happens to a message. This issues a Pairing code, or counts a
 * reminder, for an unknown Sender in a Direct chat under the pairing policy,
 * and for a Group chat that is not registered under any policy but `disabled`.
 *
 * In a Group chat nobody but a Sender on the allowlist can get an answer out
 * of the bot before the group is registered: they must mention the bot, and
 * the code they are given registers the group once the user approves it.
 */
export function decide(stateDir: string, { senderId, group }: Origin, now: number, makeCode: () => string): Decision {
  return update<Decision>(stateDir, now, access => {
    if (access.policy === 'disabled' || !SAFE_SENDER_ID.test(senderId)) return [{ action: 'drop' }, false]
    const allowed = access.allowFrom.includes(senderId)
    if (group) {
      if (!SAFE_SENDER_ID.test(group.id)) return [{ action: 'drop' }, false]
      if (Object.hasOwn(access.groups, group.id)) {
        const { requireMention, members } = access.groups[group.id]!
        if (requireMention && !group.mentionsBot) return [{ action: 'drop' }, false]
        if (members === 'allowlist' && !allowed) return [{ action: 'drop' }, false]
        return [{ action: 'deliver' }, false]
      }
      if (!allowed || !group.mentionsBot) return [{ action: 'drop' }, false]
    } else if (allowed) {
      return [{ action: 'deliver' }, false]
    }
    // `allowlist` turns away unknown Senders. A group is asked for by a Sender
    // already on the allowlist, so it can still be registered.
    if (!group && access.policy === 'allowlist') return [{ action: 'drop' }, false]

    const waiting = Object.entries(access.pending).find(([, pairing]) =>
      group ? pairing.groupId === group.id : pairing.senderId === senderId && !pairing.groupId,
    )
    if (waiting) {
      const [code, pairing] = waiting
      if (pairing.replies >= MAX_REPLIES_PER_PAIRING) return [{ action: 'drop' }, false]
      pairing.replies++
      return [{ action: 'pair', code, reminder: true }, true]
    }
    if (Object.keys(access.pending).length >= MAX_PENDING_PAIRINGS) return [{ action: 'drop' }, false]

    const code = makeCode()
    access.pending[code] = { senderId, ...(group ? { groupId: group.id } : {}), expiresAt: now + PAIRING_CODE_LIFETIME_MS, replies: 1 }
    return [{ action: 'pair', code, reminder: false }, true]
  })
}

/**
 * True when Claude may write to the chat or fetch what was sent in it, and
 * the policy is not `disabled`: a Direct chat's Sender is on the allowlist, a
 * Group chat is registered.
 */
export function mayReach(stateDir: string, chatId: string): boolean {
  const access = readAccess(stateDir)
  if (access.policy === 'disabled') return false
  const groupId = groupIdOf(chatId)
  return groupId === undefined ? access.allowFrom.includes(chatId) : Object.hasOwn(access.groups, groupId)
}

/**
 * Approves a pending Pairing: the Sender joins the allowlist, or the Group
 * chat is registered, answering only allowlisted Senders who mention the bot.
 * A marker is left for the Channel, which sends the confirmation. Returns the
 * chat ID of what was approved, or undefined when no Pairing with that code
 * is pending (it may have expired).
 */
export function approvePairing(stateDir: string, code: string, now: number): string | undefined {
  const approved = update<{ chatId: string; marker: string } | undefined>(stateDir, now, access => {
    // Object.hasOwn: a code such as "constructor" must not find an inherited property.
    if (!Object.hasOwn(access.pending, code)) return [undefined, false]
    const { senderId, groupId } = access.pending[code]!
    delete access.pending[code]
    if (groupId) {
      if (!Object.hasOwn(access.groups, groupId)) access.groups[groupId] = { requireMention: true, members: 'allowlist' }
      return [{ chatId: groupChatId(groupId), marker: GROUP_MARKER_PREFIX + groupId }, true]
    }
    if (!access.allowFrom.includes(senderId)) access.allowFrom.push(senderId)
    return [{ chatId: senderId, marker: senderId }, true]
  })
  if (approved) {
    mkdirSync(approvedDir(stateDir), { recursive: true, mode: 0o700 })
    writeFileSync(join(approvedDir(stateDir), approved.marker), '', { mode: 0o600 })
  }
  return approved?.chatId
}

/** Changes how a registered Group chat is served. Returns false when the group is not registered. */
export function changeGroup(stateDir: string, groupId: string, change: Partial<GroupAccess>, now: number): boolean {
  return update(stateDir, now, access => {
    if (!Object.hasOwn(access.groups, groupId)) return [false, false]
    Object.assign(access.groups[groupId]!, change)
    return [true, true]
  })
}

/** Stops answering in a Group chat. Returns false when the group was not registered. */
export function removeGroup(stateDir: string, groupId: string, now: number): boolean {
  return update(stateDir, now, access => {
    const found = Object.hasOwn(access.groups, groupId)
    delete access.groups[groupId]
    return [found, found]
  })
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
 * Returns the chat IDs of the Senders and Group chats approved since the last
 * call and clears their markers, so that each approval is confirmed once.
 */
export function takeApproved(stateDir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(approvedDir(stateDir))
  } catch {
    return []
  }
  for (const name of names) rmSync(join(approvedDir(stateDir), name), { force: true })
  return names.flatMap(name => {
    const groupId = name.startsWith(GROUP_MARKER_PREFIX) ? name.slice(GROUP_MARKER_PREFIX.length) : undefined
    const id = groupId ?? name
    if (!SAFE_SENDER_ID.test(id)) return []
    return [groupId === undefined ? id : groupChatId(id)]
  })
}
