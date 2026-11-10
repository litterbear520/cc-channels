import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCredentials } from '../src/credentials.ts'

const stateDirs: string[] = []
afterEach(() => {
  for (const dir of stateDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function newStateDir(): string {
  // A directory that does not exist yet, as on a machine where the Channel never ran.
  const dir = join(mkdtempSync(join(tmpdir(), 'qq-configure-test-')), 'qq')
  stateDirs.push(join(dir, '..'))
  return dir
}

/** Runs the configure command the way the configure skill does. */
function configure(stateDir: string, ...args: string[]) {
  const result = Bun.spawnSync(['bun', join(import.meta.dir, '..', 'configure.ts'), ...args], {
    env: { ...process.env, QQ_STATE_DIR: stateDir },
  })
  return { output: result.stdout.toString() + result.stderr.toString(), exitCode: result.exitCode }
}

const mode = (path: string) => statSync(path).mode & 0o777

test('set stores the AppID and AppSecret in a file only the owner can read', () => {
  const stateDir = newStateDir()
  const { output, exitCode } = configure(stateDir, 'set', '102000001', 'test-app-secret')

  expect(exitCode).toBe(0)
  expect(output).not.toContain('test-app-secret')
  expect(readFileSync(join(stateDir, '.env'), 'utf8')).toBe(
    'QQ_BOT_APP_ID=102000001\nQQ_BOT_APP_SECRET=test-app-secret\n',
  )
  expect(mode(join(stateDir, '.env'))).toBe(0o600)
  expect(mode(stateDir)).toBe(0o700)
})

test('status reports whether credentials are set without printing the AppSecret', () => {
  const stateDir = newStateDir()
  expect(configure(stateDir, 'status').output).toContain('not set')

  configure(stateDir, 'set', '102000001', 'test-app-secret')
  const { output } = configure(stateDir, 'status')
  expect(output).toContain('102000001')
  expect(output).not.toContain('not set')
  expect(output).not.toContain('test-app-secret')
})

test('set replaces earlier credentials and keeps unrelated lines', () => {
  const stateDir = newStateDir()
  configure(stateDir, 'set', '102000001', 'first-secret')
  writeFileSync(join(stateDir, '.env'), readFileSync(join(stateDir, '.env'), 'utf8') + 'OTHER_KEY=kept\n')

  configure(stateDir, 'set', '102000002', 'second-secret')

  expect(readCredentials(stateDir)).toEqual({ appId: '102000002', appSecret: 'second-secret' })
  const file = readFileSync(join(stateDir, '.env'), 'utf8')
  expect(file).toContain('OTHER_KEY=kept')
  expect(file).not.toContain('first-secret')
})

test('clear removes the stored credentials', () => {
  const stateDir = newStateDir()
  configure(stateDir, 'set', '102000001', 'test-app-secret')

  expect(configure(stateDir, 'clear').exitCode).toBe(0)

  expect(existsSync(join(stateDir, '.env'))).toBe(false)
  expect(configure(stateDir, 'status').output).toContain('not set')
})

test('set without both values changes nothing and explains the usage', () => {
  const stateDir = newStateDir()
  const { output, exitCode } = configure(stateDir, 'set', '102000001')

  expect(exitCode).not.toBe(0)
  expect(output).toContain('<AppID> <AppSecret>')
  expect(existsSync(join(stateDir, '.env'))).toBe(false)
})

test('a credentials file written by hand is read as it is and left unchanged', () => {
  const stateDir = newStateDir()
  configure(stateDir, 'set', 'x', 'y') // creates the directory
  const byHand = 'QQ_BOT_APP_ID = 102000001\nQQ_BOT_APP_SECRET="quoted-secret"\n'
  writeFileSync(join(stateDir, '.env'), byHand)

  expect(readCredentials(stateDir)).toEqual({ appId: '102000001', appSecret: 'quoted-secret' })
  expect(configure(stateDir, 'status').output).toContain('102000001')
  expect(readFileSync(join(stateDir, '.env'), 'utf8')).toBe(byHand)
})
