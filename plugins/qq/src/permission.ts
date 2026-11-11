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

/** Reads a message as an answer to a permission prompt, or returns undefined when it is not exactly one. */
export function parseVerdict(text: string): Verdict | undefined {
  const match = ANSWER.exec(text)
  if (!match) return undefined
  return {
    requestId: match[2]!.toLowerCase(),
    behavior: match[1]!.toLowerCase().startsWith('y') ? 'allow' : 'deny',
  }
}

const MAX_DESCRIPTION_LENGTH = 300
const MAX_PREVIEW_LENGTH = 600

/** The prompt a paired Sender receives. Chinese, and sent as plain text like everything the bot says itself. */
export function permissionPrompt(request: PermissionRequest): string {
  const lines = ['Claude 请求使用工具，需要你批准：', '', `工具：${shortened(request.tool_name, MAX_DESCRIPTION_LENGTH)}`]
  if (request.description) lines.push(`说明：${shortened(request.description, MAX_DESCRIPTION_LENGTH)}`)
  if (request.input_preview) lines.push(`参数：${shortened(request.input_preview, MAX_PREVIEW_LENGTH)}`)
  lines.push(
    '',
    `回复 yes ${request.request_id} 允许，回复 no ${request.request_id} 拒绝。也可以在终端里回答，先到的为准。`,
  )
  return lines.join('\n')
}

const shortened = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text)
