import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { approvePairing } from '../src/access.ts'
import { saveCredentials } from '../src/credentials.ts'
import { receivedLogFile } from '../src/received-log.ts'
import { seenMessagesFile } from '../src/seen-messages.ts'
import { sessionFile } from '../src/session-file.ts'
import { removeAfterTest } from './cleanup.ts'
import { FakeQQGateway } from './fake-gateway.ts'
import { credentials, groupMessageFrom, messageFrom, settle, startChannel, startWithPairedSender } from './start-channel.ts'

/*
 * What the Channel keeps in its state directory so that a restart loses as
 * little as it can: the gateway session, the IDs of recent messages, and the
 * received log.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const modeOf = (path: string) => statSync(path).mode & 0o777
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const receivedLines = (stateDir: string) =>
  readFileSync(receivedLogFile(stateDir), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))

/** Starts the Channel again on the state directory of one that was stopped, with a new connection to QQ. */
async function restart(stateDir: string, options: Parameters<typeof startChannel>[0] = {}) {
  const started = await startChannel({ ...options, stateDir, gateway: new FakeQQGateway() })
  await started.initialize()
  await settle()
  return started
}

test('the gateway session is saved owner-only in the state directory and resumed after a restart', async () => {
  const first = await startWithPairedSender('SENDER1')
  first.gateway.receive(messageFrom('SENDER1'))
  await settle()

  const path = sessionFile(first.stateDir)
  // The Pairing message and this one were the two events of the gateway session.
  expect(readJson(path)).toEqual({ appId: credentials.appId, sessionId: 'gateway-session-1', lastSeq: 2 })
  expect(modeOf(path)).toBe(0o600)

  await first.channel.stop()
  const second = await restart(first.stateDir)

  expect(second.gateway.resumed).toEqual({ sessionId: 'gateway-session-1', lastSeq: 2 })
  expect(second.gateway.sessionsStarted).toBe(0)
})

test('a gateway session QQ no longer takes back is cleared, and the next restart resumes the new one', async () => {
  const first = await startWithPairedSender('SENDER1')
  first.gateway.invalidateSession()

  expect(readJson(sessionFile(first.stateDir)).sessionId).toBe('gateway-session-2')

  await first.channel.stop()
  const second = await restart(first.stateDir)
  expect(second.gateway.resumed?.sessionId).toBe('gateway-session-2')
})

test("another bot's gateway session, left from earlier credentials, is not resumed", async () => {
  const first = await startWithPairedSender('SENDER1')
  await first.channel.stop()
  saveCredentials(first.stateDir, { appId: '102000002', appSecret: 'other-app-secret' })

  const second = await restart(first.stateDir)

  expect(second.gateway.resumed).toBeUndefined()
  expect(second.gateway.sessionsStarted).toBe(1)
  expect(readJson(sessionFile(first.stateDir)).appId).toBe('102000002')
})

test('a message QQ delivers again after a restart is not passed on a second time', async () => {
  const first = await startWithPairedSender('SENDER1')
  const message = messageFrom('SENDER1', 'run the tests')
  first.gateway.receive(message)
  await settle()
  expect(first.events.map(event => event.content)).toEqual(['run the tests'])
  expect(modeOf(seenMessagesFile(first.stateDir))).toBe(0o600)

  await first.channel.stop()
  const second = await restart(first.stateDir)
  // A resumed gateway session delivers again what came before the last saved sequence number.
  second.gateway.receive(message)
  second.gateway.receive(messageFrom('SENDER1', 'and the lint'))
  await settle()

  expect(second.events.map(event => event.content)).toEqual(['and the lint'])
})

test('a message is written to the received log before it is passed on to the session', async () => {
  const { gateway, stateDir, clock, events, request, initialize } = await startChannel({ pairingCodes: ['a1b2c3'] })
  // Claude Code has not listed the tools yet, so the Channel holds every event back.
  await initialize({ listTools: false })
  await settle()
  gateway.receive(messageFrom('SENDER1'))
  await settle()
  approvePairing(stateDir, 'a1b2c3', clock.now)
  gateway.receive({
    ...messageFrom('SENDER1', 'what is in these?'),
    quoted: { text: 'the logs', attachments: [] },
    attachments: [{ url: 'https://qq.example/a', contentType: 'file', name: 'build log.txt', size: 2048 }],
  })
  await settle()

  expect(events).toHaveLength(0)
  // The Pairing message was answered with a code, not passed on, so it is not in the log.
  const lines = receivedLines(stateDir)
  expect(lines).toEqual([
    {
      message_id: expect.any(String),
      chat_id: 'SENDER1',
      sender_id: 'SENDER1',
      ts: '2026-11-11T09:00:00+08:00',
      text: '> the logs\n\nwhat is in these?',
      attachments: ['build_log.txt'],
    },
  ])
  expect(modeOf(receivedLogFile(stateDir))).toBe(0o600)

  await request('tools/list')
  await settle()
  expect(events).toHaveLength(1)
  expect(events[0]!.content).toBe(lines[0].text)
  expect(events[0]!.meta?.message_id).toBe(lines[0].message_id)
})

test('a group message is logged with the group as its chat', async () => {
  const { gateway, stateDir, clock } = await startWithPairedSender('SENDER1')
  gateway.receive(groupMessageFrom('SENDER1', 'GROUP1'))
  await settle()
  approvePairing(stateDir, /pair ([0-9a-f]{6})/.exec(gateway.sent[0]!.text!)![1]!, clock.now)

  gateway.receive(groupMessageFrom('SENDER1', 'GROUP1', 'status?'))
  await settle()

  expect(receivedLines(stateDir).map(line => [line.chat_id, line.sender_id, line.text])).toEqual([
    ['group:GROUP1', 'SENDER1', 'status?'],
  ])
})

test('when the received log cannot be written, the message is passed on all the same', async () => {
  const { gateway, stateDir, events, logged } = await startWithPairedSender('SENDER1')
  // A directory where the file should be makes every write fail.
  mkdirSync(receivedLogFile(stateDir))

  gateway.receive(messageFrom('SENDER1', 'still there?'))
  await settle()

  expect(events.map(event => event.content)).toEqual(['still there?'])
  expect(logged.join('\n')).toContain('could not write a message to the received log; passing it on anyway')
})

test('lines older than seven days leave the received log at startup and once a day after', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'qq-channel-test-'))
  removeAfterTest(stateDir)
  saveCredentials(stateDir, credentials)
  const startup = Date.UTC(2026, 10, 11, 9, 0, 0)
  const line = (id: string, ageMs: number) =>
    JSON.stringify({ message_id: id, chat_id: 'SENDER1', sender_id: 'SENDER1', ts: new Date(startup - ageMs).toISOString(), text: id, attachments: [] })
  writeFileSync(
    receivedLogFile(stateDir),
    [line('eight days old', 8 * DAY_MS), line('six days old', 6 * DAY_MS), '{"message_id": "cut sh', line('today', 0)].join('\n') + '\n',
    { mode: 0o644 },
  )

  const { clock } = await startChannel({ stateDir, receivedLogPruneMs: 5 })
  await settle()

  expect(receivedLines(stateDir).map(entry => entry.message_id)).toEqual(['six days old', 'today'])
  expect(modeOf(receivedLogFile(stateDir))).toBe(0o600)

  clock.now += 2 * DAY_MS
  await settle()

  expect(receivedLines(stateDir).map(entry => entry.message_id)).toEqual(['today'])
})
