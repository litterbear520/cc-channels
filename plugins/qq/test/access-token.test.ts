import { expect, test } from 'bun:test'
import { createAccessTokenSource } from '../src/access-token.ts'
import { CredentialsRejectedError } from '../src/gateway.ts'

const credentials = { appId: '102000001', appSecret: 'test-app-secret' }
const MINUTE = 60_000

/** A stand-in for QQ's token endpoint, with a clock the test moves by hand. */
function fakeQQ() {
  const qq = {
    now: 1_700_000_000_000,
    requests: [] as { url: string; body: unknown }[],
    /** What the endpoint answers next; defaults to a fresh two-hour token. */
    respond: (): Response | Promise<Response> => qq.issue(`token-${qq.requests.length}`, 7200),
    issue: (token: string, expiresInSeconds: number) =>
      // QQ sends expires_in as a string.
      Response.json({ access_token: token, expires_in: String(expiresInSeconds) }),
    advance: (ms: number) => {
      qq.now += ms
    },
  }
  const tokens = createAccessTokenSource({
    credentials,
    now: () => qq.now,
    fetch: async (url, init) => {
      qq.requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return qq.respond()
    },
  })
  return { qq, tokens }
}

test('exchanges the AppID and AppSecret for an access token', async () => {
  const { qq, tokens } = fakeQQ()

  expect(await tokens.get()).toBe('token-1')
  expect(qq.requests).toEqual([
    {
      url: 'https://bots.qq.com/app/getAppAccessToken',
      body: { appId: '102000001', clientSecret: 'test-app-secret' },
    },
  ])
})

test('reuses the token until five minutes before it expires, then fetches a new one', async () => {
  const { qq, tokens } = fakeQQ()
  await tokens.get()

  qq.advance(114 * MINUTE)
  expect(await tokens.get()).toBe('token-1')
  expect(qq.requests).toHaveLength(1)

  qq.advance(2 * MINUTE) // four minutes of the two hours left
  expect(await tokens.get()).toBe('token-2')
  expect(qq.requests).toHaveLength(2)
})

test('when QQ hands back the same token with little time left, asks again only as expiry nears', async () => {
  // QQ issues a new token only in the last minute of the old one.
  const { qq, tokens } = fakeQQ()
  qq.respond = () => qq.issue('old-token', 240)
  expect(await tokens.get()).toBe('old-token')

  qq.advance(2 * MINUTE) // 120 s left, more than a third of 240 s
  expect(await tokens.get()).toBe('old-token')
  expect(qq.requests).toHaveLength(1)

  qq.advance(MINUTE) // 60 s left
  qq.respond = () => qq.issue('new-token', 7200)
  expect(await tokens.get()).toBe('new-token')
  expect(qq.requests).toHaveLength(2)
})

test('simultaneous requests share one exchange', async () => {
  const { qq, tokens } = fakeQQ()

  expect(await Promise.all([tokens.get(), tokens.get(), tokens.get()])).toEqual(['token-1', 'token-1', 'token-1'])
  expect(qq.requests).toHaveLength(1)
})

test('forgetting the token forces a new exchange', async () => {
  const { qq, tokens } = fakeQQ()
  await tokens.get()

  tokens.forget()

  expect(await tokens.get()).toBe('token-2')
  expect(qq.requests).toHaveLength(2)
})

test('reports rejected credentials as such, with the code QQ gave', async () => {
  const { qq, tokens } = fakeQQ()
  // QQ answers a bad AppID or AppSecret with HTTP 200 and an error body.
  qq.respond = () => Response.json({ code: 10004, message: '机器人不存在' })

  const error = await tokens.get().catch(e => e)
  expect(error).toBeInstanceOf(CredentialsRejectedError)
  expect(error.message).toContain('10004')
})

test('treats a server error or an unreachable QQ as temporary, not as rejected credentials', async () => {
  const { qq, tokens } = fakeQQ()

  qq.respond = () => new Response('bad gateway', { status: 502 })
  const serverError = await tokens.get().catch(e => e)
  expect(serverError).toBeInstanceOf(Error)
  expect(serverError).not.toBeInstanceOf(CredentialsRejectedError)

  for (const temporary of [
    new Response('slow down', { status: 429 }),
    new Response('<html>blocked by a proxy</html>', { status: 200 }),
    Response.json({ code: 100001, message: 'Too many requests' }),
  ]) {
    qq.respond = () => temporary
    expect(await tokens.get().catch(e => e)).not.toBeInstanceOf(CredentialsRejectedError)
  }

  qq.respond = () => Promise.reject(new Error('getaddrinfo ENOTFOUND bots.qq.com'))
  const unreachable = await tokens.get().catch(e => e)
  expect(unreachable).not.toBeInstanceOf(CredentialsRejectedError)
  expect(unreachable.message).toContain('ENOTFOUND')

  qq.respond = () => qq.issue('token-after-recovery', 7200)
  expect(await tokens.get()).toBe('token-after-recovery')
})

test('no error carries the AppSecret, even when QQ or the network echoes it', async () => {
  const { qq, tokens } = fakeQQ()

  qq.respond = () => Response.json({ code: 10004, message: `bad secret ${credentials.appSecret}` })
  expect(String(await tokens.get().catch(e => e))).not.toContain(credentials.appSecret)

  qq.respond = () => new Response(`echo ${credentials.appSecret}`, { status: 500 })
  expect(String(await tokens.get().catch(e => e))).not.toContain(credentials.appSecret)

  qq.respond = () => Promise.reject(new Error(`failed to send ${credentials.appSecret}`))
  expect(String(await tokens.get().catch(e => e))).not.toContain(credentials.appSecret)
})
