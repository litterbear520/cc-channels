# QQ

[简体中文](README.zh-CN.md)

Connect a QQ bot to your Claude Code with an MCP server.

When the bot receives a message in a Direct chat or a group, the MCP server forwards it to Claude and provides tools to reply, send images and files, and take a message back. Tool permission prompts are relayed to QQ too, so you can approve them from your phone.

It uses only the official QQ Bot API, and dials out to QQ over WebSocket: you need no public URL, tunnel, or server.

## Prerequisites

- [Bun](https://bun.sh) — the MCP server runs on Bun. Install with `curl -fsSL https://bun.sh/install | bash`. Tested with Bun 1.4.3.
- Claude Code, signed in with claude.ai or a Console API key. Channels are not available through Amazon Bedrock, Google Cloud, or Microsoft Foundry. Tested with Claude Code 2.1.322.
- A QQ account, to create a bot on the QQ open platform. An unverified individual account is enough.

## Quick Setup
> Default Pairing flow for a single-user Direct chat bot. See [ACCESS.md](./ACCESS.md) for groups and multi-user setups.

**1. Create a QQ bot.**

Sign in to the [QQ open platform](https://q.qq.com) and create a bot (机器人).

Open the bot's 开发设置 page. Under 事件订阅与回调地址, choose **WebSocket** as the way events are delivered. If the console lists events to subscribe to, include the Direct chat message event (单聊消息, `C2C_MESSAGE_CREATE`).

Leave the IP allowlist (IP 白名单) empty unless you know the address your machine connects from.

> The bot's creator can open a Direct chat with their own bot with no further step. QQ limits who else can message a bot owned by an individual; see QQ's own documentation for the current rules.

**2. Copy the AppID and AppSecret.**

Both are on the same 开发设置 page. Hold onto them for step 4.

**3. Install the plugin.**

These are Claude Code commands — run `claude` to start a session first.

Add the marketplace, then install the plugin:

```
/plugin marketplace add litterbear520/cc-channels
/plugin install qq@cc-channels
```

The plugin's dependencies are installed from its lockfile when the plugin is installed, or at the latest the first time it starts. It ships no registry configuration, so the install follows your own Bun or npm configuration, mirror included.

**4. Give the server the credentials.**

```
/qq:configure <AppID> <AppSecret>
```

Writes `QQ_BOT_APP_ID=...` and `QQ_BOT_APP_SECRET=...` to `~/.claude/channels/qq/.env`, readable by your account only. `/qq:configure` with no arguments shows whether credentials are set, without printing the AppSecret; `/qq:configure clear` removes them.

> To run multiple bots on one machine (different credentials, separate allowlists), point `QQ_STATE_DIR` at a different directory per instance.

**5. Relaunch with the channel flag.**

Without this no QQ message reaches your session — exit it and start a new one:

```sh
claude --dangerously-load-development-channels plugin:qq@cc-channels
```

Channels are a research preview, and Claude Code loads only the channel plugins on Anthropic's allowlist. This plugin is not on that list, so a start without the flag loads its skills but does not register the channel, and no QQ message arrives. The flag works in interactive sessions only: with `-p` or through the Agent SDK, Claude Code ignores it. Claude Code asks you to confirm it at startup.

Messages arrive only while that session is open. To stay reachable, keep it running in a persistent terminal.

**6. Pair.**

With Claude Code running from the previous step, send your bot any message in a QQ Direct chat — it replies with a Pairing code. If the bot doesn't respond, make sure your session is running with the flag. In your Claude Code session:

```
/qq:access pair <code>
```

The bot confirms in QQ. Your next message reaches the assistant.

**7. Lock it down.**

Pairing is for capturing IDs. Once you're in, switch to `allowlist` so strangers don't get pairing-code replies. Ask Claude to do it, or `/qq:access policy allowlist` directly.

## Access control

See **[ACCESS.md](./ACCESS.md)** for the access policies, groups, mention handling, skill commands, and the `access.json` schema.

Quick reference: IDs are QQ **openids** (long opaque strings, unique to this bot, not QQ numbers — QQ shows them nowhere in its client, so pairing captures them). Default policy is `pairing`. Groups are opt-in, one Pairing code per group.

Anyone on the allowlist can give your Claude Code session instructions, with whatever permissions that session has. Pair only people you would let type into your terminal.

## Tools exposed to the assistant

| Tool | Purpose |
| --- | --- |
| `reply` | Send to a Direct chat or a group. Takes `chat_id` + `text`, optionally `reply_to` (message ID) to show the answer as quoting that message and `files` (absolute paths) for attachments — max 10 files, 25 MB each. Text is sent as Markdown and auto-chunked at 2000 characters. Returns the sent message ID(s). |
| `download_attachment` | Download all attachments from a specific message by ID to `~/.claude/channels/qq/inbox/`. Returns file paths + metadata. |
| `recall` | Take back a message the bot sent, within two minutes of sending it. Only works on messages sent since the server last started. |

Inbound Direct chat messages trigger a typing status automatically. QQ has none in groups.

QQ offers a bot no way to edit a message, add a reaction, or look up history, so there are no tools for those.

## What Claude sees

A message from a paired Sender arrives in the session as a `<channel>` event:

```
<channel source="qq" chat_id="…" message_id="…" sender_id="…" ts="2026-11-11T09:00:00+08:00">
run the tests and tell me what failed
</channel>
```

One from a group also says who wrote it and whether the bot was mentioned:

```
<channel source="qq" chat_id="group:…" message_id="…" sender_id="…" ts="…" chat_type="group" mentioned="true" user="Alice">
what broke the build?
</channel>
```

A message with images or files carries `attachment_count` and `attachments`; one that quotes an earlier message carries `quoting="true"` and begins with the quoted text as a block quote. Claude answers by passing the tag's `chat_id` to `reply`.

## Attachments

Attachments are **not** auto-downloaded. The `<channel>` notification lists each attachment's name, type, and size — the assistant calls `download_attachment(chat_id, message_id)` when it actually wants the file. Downloads land in `~/.claude/channels/qq/inbox/`. A download stops at 25 MB or after two minutes.

Only recent messages can be fetched this way, and none from before a restart: QQ cannot be asked for a past message, so the server keeps the attachment references in memory.

Outbound, a `.png`, `.jpg`, `.jpeg` or `.gif` is shown as an image, a GIF animated; anything else arrives as a file. A file over 5 MB goes through QQ's chunked upload, which takes a few seconds longer; one over 25 MB is refused. Files in the state directory other than the inbox, such as `.env`, are never sent.

## Permission prompts

When Claude Code needs approval for a tool call, the prompt is also sent to the Direct chat of every paired Sender, with an 允许 (allow) and a 拒绝 (deny) button under it. Press one, or answer `yes <id>` or `no <id>` (or `y` / `n`) with the ID shown in the prompt. Where QQ does not take the buttons, the prompt arrives as plain text and the written answer still works. The terminal prompt keeps working, and whichever answer comes first wins. A bare "yes" approves nothing. Prompts are never sent to a group, and neither an answer written in a group nor a button pressed there is taken as one. QQ cannot edit a message, so the buttons stay under a prompt that has been answered; pressing one then does nothing.

## Limits

- **Direct chats and groups only.** Guild (QQ 频道) is not supported.
- **Replies are metered by QQ.** QQ documents that a bot may answer one inbound message with at most 4 Passive replies within 60 minutes in a Direct chat, and 5 within 5 minutes in a group. Within those limits the server sends a Passive reply; beyond them it sends a Proactive message, which a Direct chat recipient can switch off and a group takes only when its owner has allowed the bot to write first. So the result of a long task may not reach a group. When a message cannot be delivered Claude is told why; nothing is queued or retried.
- **A lost answer is not sent twice.** When the connection breaks before QQ answers, the message may or may not have arrived. It is not sent again, and Claude is told so.
- **One long-lived session is the intended setup.** QQ delivers each message to every connection of a bot. If several Claude Code sessions of one account have the plugin enabled, an unknown Sender can be answered more than once.

What was seen against a real bot, including where QQ did not enforce its documented limits, is recorded in [docs/research/qq-bot-and-channels.md](../../docs/research/qq-bot-and-channels.md).

## Troubleshooting

- **The bot does not answer, or only hands out Pairing codes.** The session was started without the flag, or it has exited. Without the flag the server still starts and connects to QQ, but Claude Code drops every message it passes on. The channel is loaded only when "Channels (experimental)" at startup names `plugin:qq@cc-channels`.
- **The session says QQ rejected the credentials.** Run `/qq:configure <AppID> <AppSecret>` again and restart Claude Code: the server reads the credentials only at startup.
- **Connection events are needed.** Start with `QQ_CHANNEL_TRACE=1` to have the routine connects and reconnects written to the server's log.
