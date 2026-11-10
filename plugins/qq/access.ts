#!/usr/bin/env bun
/**
 * Shows and changes who may reach the session through QQ. Run by the access
 * skill, from the user's terminal only.
 */

import {
  ACCESS_POLICIES,
  approvePairing,
  denyPairing,
  readAccess,
  removeSender,
  setPolicy,
  type AccessPolicy,
} from './src/access.ts'
import { resolveStateDir } from './src/credentials.ts'

const USAGE = 'usage: access.ts status | pair <code> | deny <code> | remove <SenderID> | policy <pairing|allowlist|disabled>'

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
  const pending = Object.entries(access.pending).filter(([, pairing]) => pairing.expiresAt > now)
  console.log(`Pending Pairings: ${pending.length}`)
  for (const [code, pairing] of pending) {
    const minutesLeft = Math.ceil((pairing.expiresAt - now) / 60_000)
    console.log(`  ${code}  Sender ${pairing.senderId}  expires in ${minutesLeft} min`)
  }
}

try {
  switch (command) {
    case 'status':
      printStatus()
      break
    case 'pair': {
      const senderId = approvePairing(stateDir, needArgument('<code>').toLowerCase(), now)
      if (!senderId) fail('No pending Pairing has that code. It may have expired after an hour, or been mistyped.')
      console.log(`Paired Sender ${senderId}. The channel sends them a confirmation within a few seconds.`)
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
