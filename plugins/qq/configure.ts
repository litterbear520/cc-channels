#!/usr/bin/env bun
/**
 * Stores, shows, and removes the QQ bot credentials. Run by the configure
 * skill, so the AppSecret is written by code and never read back into the
 * session.
 */

import { clearCredentials, readCredentials, resolveStateDir, saveCredentials } from './src/credentials.ts'

const USAGE = 'usage: configure.ts status | set <AppID> <AppSecret> | clear'

const stateDir = resolveStateDir()
const [command, ...args] = process.argv.slice(2)

function printStatus(): void {
  const credentials = readCredentials(stateDir)
  console.log(
    credentials
      ? `Credentials: set (AppID ${credentials.appId}, AppSecret hidden)`
      : 'Credentials: not set',
  )
  console.log(`State directory: ${stateDir}`)
}

switch (command) {
  case 'status':
    printStatus()
    break
  case 'set': {
    const [appId, appSecret] = args.map(arg => arg.trim())
    if (!appId || !appSecret || args.length !== 2) {
      console.error(`set needs exactly two values: <AppID> <AppSecret>\n${USAGE}`)
      process.exit(1)
    }
    saveCredentials(stateDir, { appId, appSecret })
    printStatus()
    break
  }
  case 'clear':
    clearCredentials(stateDir)
    printStatus()
    break
  default:
    console.error(USAGE)
    process.exit(1)
}
