import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decide, takeApprovedSenders } from '../src/access.ts'

const stateDirs: string[] = []
afterEach(() => {
  for (const dir of stateDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function newStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qq-access-test-'))
  stateDirs.push(dir)
  return dir
}

/** Runs the access command the way the access skill does. */
function access(stateDir: string, ...args: string[]) {
  const result = Bun.spawnSync(['bun', join(import.meta.dir, '..', 'access.ts'), ...args], {
    env: { ...process.env, QQ_STATE_DIR: stateDir },
  })
  return { output: result.stdout.toString() + result.stderr.toString(), exitCode: result.exitCode }
}

/** Has an unknown Sender message the bot, as the Channel would see it, and be given this code. */
function unknownSenderWrites(stateDir: string, senderId: string, code: string): void {
  decide(stateDir, senderId, Date.now(), () => code)
}

test('status on a machine where nobody has written yet shows the defaults', () => {
  const { output, exitCode } = access(join(newStateDir(), 'never-created'), 'status')

  expect(exitCode).toBe(0)
  expect(output).toContain('Policy: pairing')
  expect(output).toContain('Allowed Senders: 0')
  expect(output).toContain('Pending Pairings: 0')
})

test('pair approves a pending code, and status then lists the Sender', () => {
  const stateDir = newStateDir()
  unknownSenderWrites(stateDir, 'SENDER1', 'a1b2c3')
  expect(access(stateDir, 'status').output).toContain('a1b2c3  Sender SENDER1')

  // Codes are shown in lower case; one typed in capitals is the same code.
  const paired = access(stateDir, 'pair', 'A1B2C3')

  expect(paired.exitCode).toBe(0)
  expect(paired.output).toContain('SENDER1')
  expect(decide(stateDir, 'SENDER1', Date.now(), () => 'unused')).toEqual({ action: 'deliver' })
  expect(takeApprovedSenders(stateDir)).toEqual(['SENDER1'])
  const status = access(stateDir, 'status').output
  expect(status).toContain('Allowed Senders: 1\n  SENDER1')
  expect(status).toContain('Pending Pairings: 0')
})

test('a code that names a built-in object property is refused and changes nothing', () => {
  const stateDir = newStateDir()
  unknownSenderWrites(stateDir, 'SENDER1', 'a1b2c3')
  const before = readFileSync(join(stateDir, 'access.json'), 'utf8')

  expect(access(stateDir, 'pair', 'constructor').exitCode).toBe(1)
  expect(access(stateDir, 'deny', '__proto__').exitCode).toBe(1)

  expect(readFileSync(join(stateDir, 'access.json'), 'utf8')).toBe(before)
})

test('pair refuses a code nobody was given', () => {
  const stateDir = newStateDir()

  const { output, exitCode } = access(stateDir, 'pair', 'beef00')

  expect(exitCode).toBe(1)
  expect(output).toContain('No pending Pairing')
  expect(takeApprovedSenders(stateDir)).toEqual([])
})

test('deny discards a pending code', () => {
  const stateDir = newStateDir()
  unknownSenderWrites(stateDir, 'SENDER1', 'a1b2c3')

  expect(access(stateDir, 'deny', 'a1b2c3').exitCode).toBe(0)

  expect(access(stateDir, 'pair', 'a1b2c3').exitCode).toBe(1)
})

test('remove takes a Sender off the allowlist', () => {
  const stateDir = newStateDir()
  unknownSenderWrites(stateDir, 'SENDER1', 'a1b2c3')
  access(stateDir, 'pair', 'a1b2c3')

  expect(access(stateDir, 'remove', 'SENDER1').exitCode).toBe(0)

  expect(access(stateDir, 'status').output).toContain('Allowed Senders: 0')
  expect(access(stateDir, 'remove', 'SENDER1').exitCode).toBe(1)
})

test('policy sets one of the three policies and refuses anything else', () => {
  const stateDir = newStateDir()

  expect(access(stateDir, 'policy', 'allowlist').exitCode).toBe(0)
  expect(access(stateDir, 'status').output).toContain('Policy: allowlist')

  const refused = access(stateDir, 'policy', 'open')
  expect(refused.exitCode).toBe(1)
  expect(access(stateDir, 'status').output).toContain('Policy: allowlist')
})

test('a damaged access file is reported, not replaced', () => {
  const stateDir = newStateDir()
  writeFileSync(join(stateDir, 'access.json'), '{ not json')

  const { output, exitCode } = access(stateDir, 'policy', 'pairing')

  expect(exitCode).toBe(1)
  expect(output).toContain('Could not use the access file')
})

test('a command with a missing or extra value prints the usage', () => {
  const stateDir = newStateDir()

  for (const args of [['pair'], ['pair', 'a1b2c3', 'extra'], ['nonsense'], []]) {
    const { output, exitCode } = access(stateDir, ...args)
    expect(exitCode).toBe(1)
    expect(output).toContain('usage: access.ts')
  }
})
