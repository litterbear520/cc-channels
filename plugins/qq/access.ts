#!/usr/bin/env bun
/**
 * Shows and changes who may reach the session through QQ. Run by the access
 * skill, from the user's terminal only.
 */

import {
  ACCESS_POLICIES,
  GROUP_MEMBERS,
  approvePairing,
  changeGroup,
  denyPairing,
  readAccess,
  removeGroup,
  removeSender,
  setPolicy,
  type AccessPolicy,
  type GroupAccess,
} from './src/access.ts'
import { groupIdOf } from './src/chat-id.ts'
import { resolveStateDir } from './src/credentials.ts'

const USAGE =
  'usage: access.ts status | pair <code> | deny <code> | remove <SenderID> | policy <pairing|allowlist|disabled>\n' +
  '       access.ts group mention <GroupID> <on|off> | group members <GroupID> <allowlist|everyone> | group remove <GroupID>'

const stateDir = resolveStateDir()
const [command, argument, ...extra] = process.argv.slice(2)
const now = Date.now()

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function needArgument(what: string): string {
  if (!argument || extra.length > 0) fail(`${command} needs exactly one value: ${what}\n${USAGE}`)
  return argument.trim()
}

function printStatus(): void {
  const access = readAccess(stateDir)
  console.log(`Policy: ${access.policy}`)
  console.log(`Allowed Senders: ${access.allowFrom.length}`)
  for (const senderId of access.allowFrom) console.log(`  ${senderId}`)
  // The file is only tidied when something writes it, so expired codes may still be in it.
  const groups = Object.entries(access.groups)
  console.log(`Groups: ${groups.length}`)
  for (const [groupId, group] of groups) {
    const heard = group.members === 'everyone' ? 'every member' : 'allowed Senders only'
    console.log(`  ${groupId}  ${group.requireMention ? 'hears mentions only' : 'hears every message'}  hears ${heard}`)
  }
  const pending = Object.entries(access.pending).filter(([, pairing]) => pairing.expiresAt > now)
  console.log(`Pending Pairings: ${pending.length}`)
  for (const [code, pairing] of pending) {
    const minutesLeft = Math.ceil((pairing.expiresAt - now) / 60_000)
    const what = pairing.groupId ? `Group ${pairing.groupId}, asked by Sender ${pairing.senderId}` : `Sender ${pairing.senderId}`
    console.log(`  ${code}  ${what}  expires in ${minutesLeft} min`)
  }
}

/** `group <mention|members|remove> <GroupID> [value]` */
function changeGroupFromArguments(): void {
  const [groupId, value, ...more] = extra
  const usage = `group needs: mention <GroupID> <on|off>, members <GroupID> <allowlist|everyone>, or remove <GroupID>\n${USAGE}`
  if (!groupId || more.length > 0) fail(usage)
  const notRegistered = 'That group is not registered. Groups are listed by status.'
  if (argument === 'remove') {
    if (value !== undefined) fail(usage)
    if (!removeGroup(stateDir, groupId, now)) fail(notRegistered)
    console.log('Group removed.')
    return
  }
  let change: Partial<GroupAccess>
  if (argument === 'mention' && (value === 'on' || value === 'off')) {
    change = { requireMention: value === 'on' }
  } else if (argument === 'members' && GROUP_MEMBERS.includes(value as GroupAccess['members'])) {
    change = { members: value as GroupAccess['members'] }
  } else {
    fail(usage)
  }
  if (!changeGroup(stateDir, groupId, change, now)) fail(notRegistered)
  const group = readAccess(stateDir).groups[groupId]!
  console.log(
    `Group ${groupId}: ${group.requireMention ? 'hears mentions only' : 'hears every message'}, ` +
      `hears ${group.members === 'everyone' ? 'every member' : 'allowed Senders only'}.`,
  )
}

try {
  switch (command) {
    case 'status':
      printStatus()
      break
    case 'pair': {
      const chatId = approvePairing(stateDir, needArgument('<code>').toLowerCase(), now)
      if (!chatId) fail('No pending Pairing has that code. It may have expired after an hour, or been mistyped.')
      const groupId = groupIdOf(chatId)
      if (groupId === undefined) {
        console.log(`Paired Sender ${chatId}. The channel sends them a confirmation within a few seconds.`)
      } else {
        console.log(
          `Registered Group ${groupId}. It answers allowed Senders who mention the bot; ` +
            'the channel confirms it in the group within a few seconds.',
        )
      }
      break
    }
    case 'deny':
      if (!denyPairing(stateDir, needArgument('<code>').toLowerCase(), now)) fail('No pending Pairing has that code.')
      console.log('Pairing discarded.')
      break
    case 'remove':
      if (!removeSender(stateDir, needArgument('<SenderID>'), now)) fail('That Sender is not on the allowlist.')
      console.log('Sender removed.')
      break
    case 'group':
      changeGroupFromArguments()
      break
    case 'policy': {
      const policy = needArgument('<pairing|allowlist|disabled>') as AccessPolicy
      if (!ACCESS_POLICIES.includes(policy)) fail(`Unknown policy "${policy}".\n${USAGE}`)
      setPolicy(stateDir, policy, now)
      console.log(`Policy: ${policy}`)
      break
    }
    default:
      fail(USAGE)
  }
} catch (error) {
  fail(`Could not use the access file in ${stateDir}: ${error instanceof Error ? error.message : error}`)
}
