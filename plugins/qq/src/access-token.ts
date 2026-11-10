import type { Credentials } from './credentials.ts'
import { CredentialsRejectedError } from './gateway.ts'

const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
const REQUEST_TIMEOUT_MS = 10_000
/** QQ's business code for "too many requests". */
const RATE_LIMITED_CODE = 100001
/** How long before its expiry a token is replaced. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

export interface AccessTokenSource {
  /**
   * Returns an access token that is not about to expire, exchanging the
   * credentials for a new one when needed. Rejects with
   * {@link CredentialsRejectedError} when QQ refuses the credentials, and with
   * a plain error when QQ cannot be reached or fails.
   */
  get(): Promise<string>
  /** Drops the cached token, so the next `get` exchanges the credentials again. */
  forget(): void
}

export interface AccessTokenSourceOptions {
  credentials: Credentials
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  now?: () => number
}

export function createAccessTokenSource({
  credentials,
  fetch = globalThis.fetch,
  now = Date.now,
}: AccessTokenSourceOptions): AccessTokenSource {
  let cached: { token: string; expiresAt: number; lifetime: number } | undefined
  let inFlight: Promise<string> | undefined

  const withoutSecret = (text: string) => text.replaceAll(credentials.appSecret, '***')

  /**
   * A token is replaced five minutes ahead of its expiry. QQ only issues a new
   * one in the last minute of the old one and until then returns the old one
   * again, so a token that arrives short-lived is kept for two thirds of what
   * it has left. That closes in on the last minute without asking QQ on every call.
   */
  function isFresh(token: NonNullable<typeof cached>): boolean {
    const margin = Math.min(REFRESH_MARGIN_MS, token.lifetime / 3)
    return now() < token.expiresAt - margin
  }

  async function exchange(): Promise<string> {
    let response: Response
    try {
      response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: credentials.appId, clientSecret: credentials.appSecret }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(withoutSecret(`could not reach QQ for an access token: ${reason}`))
    }
    const body = (await response.json().catch(() => undefined)) as
      | { access_token?: unknown; expires_in?: unknown; code?: unknown; message?: unknown }
      | undefined
    if (typeof body?.access_token !== 'string' || body.access_token === '') {
      const detail = withoutSecret(
        [`HTTP ${response.status}`, body?.code && `code ${body.code}`, body?.message].filter(Boolean).join(', '),
      )
      // QQ answers a bad AppID or AppSecret with HTTP 200 and an error code in
      // the body. Anything else without a token (a server error, rate
      // limiting, a proxy's error page) may pass, so it is worth another try.
      const refused =
        response.status < 500 &&
        response.status !== 429 &&
        typeof body?.code === 'number' &&
        body.code !== RATE_LIMITED_CODE
      if (refused) throw new CredentialsRejectedError(`QQ rejected the credentials (${detail})`)
      throw new Error(`QQ did not issue an access token (${detail})`)
    }

    const lifetime = (Number(body.expires_in) || 7200) * 1000
    cached = { token: body.access_token, expiresAt: now() + lifetime, lifetime }
    return body.access_token
  }

  return {
    get() {
      if (cached && isFresh(cached)) return Promise.resolve(cached.token)
      inFlight ??= exchange().finally(() => {
        inFlight = undefined
      })
      return inFlight
    },
    forget() {
      cached = undefined
    },
  }
}
