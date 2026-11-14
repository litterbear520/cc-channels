/**
 * A chat ID names one conversation, in the `chat_id` Claude sees and passes
 * back. A Direct chat's is its Sender's ID. A Group chat's is `group:` and
 * then QQ's ID for the group; QQ's IDs never contain a colon, so the two
 * cannot be confused.
 */
const GROUP_PREFIX = 'group:'

export const groupChatId = (groupId: string) => `${GROUP_PREFIX}${groupId}`

/** QQ's ID for the group, or undefined when the chat ID names a Direct chat. */
export const groupIdOf = (chatId: string) => (chatId.startsWith(GROUP_PREFIX) ? chatId.slice(GROUP_PREFIX.length) : undefined)
