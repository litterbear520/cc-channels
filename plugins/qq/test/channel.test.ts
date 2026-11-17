import { expect, test } from 'bun:test'
import { CredentialsRejectedError } from '../src/gateway.ts'
import { FakeQQGateway } from './fake-gateway.ts'
import { credentials, settle, startChannel } from './start-channel.ts'

test('the Channel connects to QQ with the stored credentials and disconnects when it stops', async () => {
  const { channel, gateway, logged } = await startChannel()
  await settle()
  expect(gateway.connectedWith).toEqual(credentials)
  expect(logged).toContain('connected to QQ')

  await channel.stop()
  expect(gateway.connectedWith).toBeUndefined()
})

test('Claude Code can register the server as a Channel', async () => {
  const { initialize } = await startChannel()

  // Claude Code does not register a server that agrees to 2026-07-28 as a Channel.
  const result = await initialize()

  expect(result.capabilities.experimental['claude/channel']).toEqual({})
  expect(result.protocolVersion).toBe('2025-11-25')
})

test('without credentials the Channel stays loaded and tells the session to run the configure skill', async () => {
  const { gateway, logged, events, request, initialize } = await startChannel({ configured: false })
  await initialize()
  await settle()

  expect(gateway.connectAttempts).toBe(0)
  expect(events).toHaveLength(1)
  expect(events[0]!.content).toContain('/qq:configure')
  expect(events[0]!.meta).toEqual({ kind: 'status' })
  expect(logged.join('\n')).toContain('/qq:configure')
  // Still serving: the configure skill needs the plugin loaded.
  expect(await request('ping')).toEqual({})
})

test('when QQ rejects the credentials the Channel says so once and does not try again', async () => {
  const gateway = new FakeQQGateway()
  gateway.failNextConnectWith = new CredentialsRejectedError('QQ rejected the credentials (HTTP 200, code 10004)')
  const { logged, events, request, initialize } = await startChannel({ gateway })
  await initialize()
  await settle()

  expect(gateway.connectAttempts).toBe(1)
  expect(events).toHaveLength(1)
  expect(events[0]!.content).toContain('QQ rejected the credentials (HTTP 200, code 10004)')
  expect(events[0]!.content).toContain('/qq:configure')
  expect(logged.join('\n')).toContain('rejected')
  expect(await request('ping')).toEqual({})
})

test('a status event waits until Claude Code has listed the tools, which is when it starts listening', async () => {
  const { events, dropped, request, initialize } = await startChannel({ configured: false })
  await settle()
  await initialize({ listTools: false })
  await settle()
  expect(events).toHaveLength(0)
  expect(dropped).toHaveLength(0)

  await request('tools/list')
  await settle()
  expect(dropped).toHaveLength(0)
  expect(events).toHaveLength(1)
  expect(events[0]!.content).toContain('/qq:configure')
})

test('nothing the Channel logs or pushes contains the AppSecret', async () => {
  const gateway = new FakeQQGateway()
  gateway.failNextConnectWith = new Error(`socket closed while sending ${credentials.appSecret}`)
  const { logged, events, initialize } = await startChannel({ gateway })
  await initialize()
  await settle()

  expect(logged.length).toBeGreaterThan(0)
  expect(JSON.stringify([logged, events])).not.toContain(credentials.appSecret)
})

test('when an established connection is lost for good the Channel tells the session', async () => {
  const { gateway, logged, events, initialize } = await startChannel()
  await initialize()
  await settle()
  expect(events).toHaveLength(0)

  gateway.loseConnection(new Error('Gateway closed (4915): banned'))
  await settle()

  expect(events).toHaveLength(1)
  expect(events[0]!.content).toContain('Gateway closed (4915): banned')
  expect(events[0]!.meta).toEqual({ kind: 'status' })
  expect(logged.join('\n')).toContain('Gateway closed (4915): banned')
})
