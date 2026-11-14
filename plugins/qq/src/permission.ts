/**
 * Relaying Claude Code's tool permission prompts to QQ: the text of the
 * prompt, and the one answer format that counts as a verdict.
 */

/** What Claude Code sends when a tool call needs approval. Every field is untrusted text. */
export interface PermissionRequest {
  request_id: string
  tool_name: string
  description: string
  input_preview: string
}

export interface Verdict {
  requestId: string
  behavior: 'allow' | 'deny'
}

/**
 * The pattern from the channels reference. A request ID is five lowercase
 * letters without `l`; the match ignores case because phones capitalise. A
 * bare "yes" does not match, so ordinary conversation never approves anything.
 */
const ANSWER = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i
const REQUEST_ID = /^[a-km-z]{5}$/

/**
 * Checks what arrived as a permission request. Returns undefined unless it has
 * a request ID of the documented shape and text in the other fields, so that
 * nothing else is ever put into a message to a Sender.
 */
export function readPermissionRequest(params: unknown): PermissionRequest | undefined {
  if (typeof params !== 'object' || params === null) return undefined
  const { request_id, tool_name, description, input_preview } = params as Record<string, unknown>
  if (typeof request_id !== 'string' || !REQUEST_ID.test(request_id)) return undefined
  if (typeof tool_name !== 'string') return undefined
  return {
    request_id,
    tool_name,
    description: typeof description === 'string' ? description : '',
    input_preview: typeof input_preview === 'string' ? input_preview : '',
  }
}

/** Reads a message as an answer to a permission prompt, or returns undefined when it is not exactly one. */
export function parseVerdict(text: string): Verdict | undefined {
  const match = ANSWER.exec(text)
  if (!match) return undefined
  return {
    requestId: match[2]!.toLowerCase(),
    behavior: match[1]!.toLowerCase().startsWith('y') ? 'allow' : 'deny',
  }
}

const MAX_TOOL_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 300
const MAX_PREVIEW_LENGTH = 600

/** The prompt a paired Sender receives. Chinese, and sent as plain text like everything the bot says itself. */
export function permissionPrompt(request: PermissionRequest): string {
  const lines = ['Claude 请求使用工具，需要你批准：', '', `工具：${shortened(request.tool_name, MAX_TOOL_NAME_LENGTH)}`]
  if (request.description) lines.push(`说明：${shortened(request.description, MAX_DESCRIPTION_LENGTH)}`)
  if (request.input_preview) {
    lines.push(`参数：${bothEnds(request.input_preview, MAX_PREVIEW_LENGTH)}`)
    if (request.input_preview.length > MAX_PREVIEW_LENGTH) lines.push('参数太长，中间一段没有显示。拿不准时到终端查看完整内容再回答。')
  }
  lines.push(
    '',
    `回复 yes ${request.request_id} 允许，回复 no ${request.request_id} 拒绝。也可以在终端里回答，先到的为准。`,
  )
  return lines.join('\n')
}

const shortened = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text)

/**
 * Cuts a long text out of its middle. What a command does last is as much a
 * reason to refuse it as what it does first, so the end must reach the Sender.
 */
function bothEnds(text: string, limit: number): string {
  if (text.length <= limit) return text
  const tail = Math.floor(limit / 3)
  const head = limit - tail
  return `${text.slice(0, head)} …（省略 ${text.length - limit} 个字符）… ${text.slice(-tail)}`
}
