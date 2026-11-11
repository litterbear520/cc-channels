/**
 * The longest text sent as one message. QQ's API enforces no length, but very
 * long messages have crashed the QQ client, so this is the Channel's own limit.
 */
export const MAX_MESSAGE_LENGTH = 2000

/**
 * Splits text into pieces of at most `limit` characters, in order. It breaks
 * after a paragraph where it can, then after a line, then after a word, and
 * only then in the middle of one.
 */
export function splitText(text: string, limit = MAX_MESSAGE_LENGTH): string[] {
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    const paragraph = window.lastIndexOf('\n\n')
    const line = window.lastIndexOf('\n')
    const space = window.lastIndexOf(' ')
    // A break in the first half would waste most of a message.
    const breakAt = [paragraph, line, space].find(index => index > limit / 2)
    if (breakAt === undefined) {
      // Never between the two halves of a character outside the basic plane.
      const cut = isHighSurrogate(rest.charCodeAt(limit - 1)) ? limit - 1 : limit
      chunks.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    } else {
      chunks.push(rest.slice(0, breakAt))
      // The whitespace the text was broken at is not carried into the next message.
      rest = rest.slice(breakAt).replace(/^\s+/, '')
    }
  }
  if (rest) chunks.push(rest)
  return chunks
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff
