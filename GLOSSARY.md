# cc-channels

A Claude Code plugin marketplace that connects instant-messaging platforms to a running Claude Code session, one plugin per platform.

## Language

**Platform**:
An instant-messaging service whose users talk to Claude Code through this project, such as QQ or 飞书.
_Avoid_: 渠道, channel, IM

**Channel**:
The MCP server inside one plugin that pushes a Platform's messages into a Claude Code session. Each plugin has exactly one.
_Avoid_: 渠道, bridge, connector

**Sender**:
The person who wrote an inbound message, identified by the Platform's own user ID. Access is decided per Sender: a Group chat hears only allowlisted Senders unless the Claude Code user has opened that one group to all its members.
_Avoid_: user, author, member

**Pairing**:
The one-time exchange in which an unknown Sender receives a code from the bot and the Claude Code user approves that code in the terminal, adding the Sender to the allowlist. A Group chat is registered by the same exchange, started by a Sender who is already on the allowlist.
_Avoid_: binding, linking, verification

**Direct chat**:
A one-to-one conversation between a Sender and the bot on QQ.
_Avoid_: C2C, DM, 私聊, private chat

**Group chat**:
A QQ group conversation the bot has been added to, where several Senders read and write. The bot answers in one only after the Claude Code user has registered it by approving a Pairing code.
_Avoid_: 群聊 (in English text), room, guild

**Passive reply**:
A QQ message sent in answer to a specific inbound message, allowed only within a limited time and count after that message arrived.
_Avoid_: reply (unqualified), response

**Proactive message**:
A QQ message sent without reference to an inbound message, which the recipient can switch off.
_Avoid_: active message, push

**Guild**:
QQ's community product (QQ 频道), a separate messaging scene from QQ direct and group chat.
_Avoid_: channel, 频道 (unqualified)
