# cc-channels

[简体中文](README.zh-CN.md)

A Claude Code plugin marketplace that connects instant-messaging Platforms to a running Claude Code session, one plugin per Platform. Each plugin contains one Channel: an MCP server that pushes the Platform's messages into your session and lets Claude answer there.

The first plugin is `qq`. It uses only the official QQ Bot API. You send your bot a message in a QQ Direct chat, and it reaches the Claude Code session on your own machine; Claude's answers, images, files, and tool permission prompts come back into the same Direct chat. The Channel dials out to QQ over WebSocket, so you need no public URL, tunnel, or server.

> **You must start Claude Code with a development flag.**
>
> ```bash
> claude --dangerously-load-development-channels plugin:qq@cc-channels
> ```
>
> Channels are a research preview, and Claude Code loads only the Channel plugins on Anthropic's allowlist. This project is not on that list, so a normal start loads the plugin's skills but does not register its Channel, and no QQ message arrives. The flag skips the allowlist for this one plugin. It works **in interactive sessions only**: with `-p` or through the Agent SDK, Claude Code ignores it. At startup Claude Code asks you to confirm that you are loading a development Channel.

## Requirements

- Claude Code, signed in with claude.ai or a Console API key. Channels are not available through Amazon Bedrock, Google Cloud, or Microsoft Foundry. Tested with Claude Code 2.1.322.
- [Bun](https://bun.sh). The Channel runs on it. Tested with Bun 1.4.3.
- A QQ account, to create a bot on the QQ open platform.

## Set up the `qq` plugin

### 1. Create a QQ bot

1. Sign in to the [QQ open platform](https://q.qq.com) and create a bot (机器人).
2. Open the bot's 开发设置 page and note its **AppID** and **AppSecret**.
3. Under 事件订阅与回调地址, choose **WebSocket** as the way events are delivered. If the console lists events to subscribe to, include the Direct chat message event (单聊消息, `C2C_MESSAGE_CREATE`).
4. Leave the IP allowlist (IP 白名单) empty unless you know the address your machine connects from.

An unverified individual account is enough: the bot's creator can open a Direct chat with their own bot with no further step. QQ limits who else can message a bot owned by an individual; see QQ's own documentation for the current rules.

### 2. Add the marketplace and install the plugin

Clone this repository, then, in Claude Code:

```
/plugin marketplace add /path/to/cc-channels
/plugin install qq@cc-channels
```

`/plugin marketplace add` also accepts the Git URL of wherever the repository is hosted.

The plugin installs its dependencies from its lockfile the first time it starts. It ships no registry configuration of its own, so the install follows yours. If you need a mirror, set it in your own Bun or npm configuration, for example in `~/.bunfig.toml`:

```toml
[install]
registry = "https://registry.npmmirror.com"
```

See [Bun's documentation on registries](https://bun.sh/docs/install/registries).

### 3. Store the credentials

```
/qq:configure <AppID> <AppSecret>
```

They are written to `~/.claude/channels/qq/.env`, readable by your account only. `/qq:configure` with no arguments shows whether credentials are set, without printing the AppSecret; `/qq:configure clear` removes them.

### 4. Start Claude Code with the Channel

```bash
claude --dangerously-load-development-channels plugin:qq@cc-channels
```

The Channel connects to QQ when the session starts, refreshes its access token, and reconnects by itself after a network drop. If credentials are missing or QQ rejects them, the session is told so and the Channel stays loaded, so that `/qq:configure` still works. The Channel reads the credentials only at startup: restart Claude Code after changing them.

Messages arrive only while that session is open. To stay reachable, keep it running in a persistent terminal.

### 5. Pair

1. In QQ, send your bot any message in a Direct chat. It answers with a Pairing code.
2. In the Claude Code terminal, approve it:

   ```
   /qq:access pair <code>
   ```

3. The bot confirms in the Direct chat. From now on your messages reach the session.

A Pairing code expires after one hour. At most three codes wait for approval at a time, and a Sender who already has one is reminded of it once instead of getting a new one.

### 6. Manage access

| Command | What it does |
| --- | --- |
| `/qq:access` | Shows the access policy, the Senders on the allowlist, and pending Pairing codes |
| `/qq:access pair <code>` | Approves a Pairing |
| `/qq:access deny <code>` | Discards a pending Pairing |
| `/qq:access remove <SenderID>` | Takes a Sender off the allowlist |
| `/qq:access policy pairing` | Unknown Senders are answered with a Pairing code (the default) |
| `/qq:access policy allowlist` | Unknown Senders are ignored. Switch to this once you are set up |
| `/qq:access policy disabled` | Every Sender is ignored |

Access is changed only from your terminal. The Channel tells Claude never to change it because a QQ message asks.

Anyone on the allowlist can give your Claude Code session instructions, with whatever permissions that session has. Pair only people you would let type into your terminal.

## What you can do from QQ

- **Send text.** It arrives in the session tagged with your Sender ID, the message ID, and the time.
- **Send an image or a file.** Claude sees that the message carries attachments and downloads them on demand into `~/.claude/channels/qq/inbox/`.
- **Read Claude's answers.** Claude answers through the Channel's `reply` tool. Text is sent as Markdown, and text over 2000 characters is split into several messages.
- **Receive images and files** of up to 5 MB each.
- **Answer tool permission prompts.** When Claude Code needs approval for a tool call, the prompt is sent to every paired Sender. Answer `yes <id>` or `no <id>` (or `y` / `n`) with the ID shown in the prompt. The terminal prompt keeps working, and whichever answer comes first wins. A bare "yes" is never taken as an approval.

## Limits

- **Direct chat only.** Group chat and Guild (QQ 频道) are not supported.
- **No editing, reactions, or history.** QQ offers a bot none of them in a Direct chat. Claude sends a new message to correct an old one, and cannot look up earlier messages.
- **Files up to 5 MB.** Larger files are refused; QQ's chunked upload is not implemented.
- **Passive reply limits.** QQ documents that a bot may answer an inbound message with at most 4 Passive replies within 60 minutes. The Channel follows those limits: within them it sends a Passive reply to your latest message, and beyond them it sends a Proactive message, which QQ lets a recipient switch off. If neither can be delivered, Claude is told why; nothing is queued or retried later. In this project's live test, with the bot's creator as the only Sender, neither limit took effect (39 Passive replies to one message were accepted, the last after 61 minutes), and Proactive messages were still delivered after the Sender switched them off. Other Senders may be held to the documented limits.
- **Attachments are fetched only for recent messages.** QQ cannot be asked for a past message, so the Channel remembers the attachment references of recent messages in memory and loses them on a restart.
- **One long-lived session is the intended setup.** QQ delivers each message to every connection of a bot. Only the session started with the flag receives messages, but if several Claude Code sessions of one account have the plugin enabled, an unknown Sender can be answered more than once.

## Team and Enterprise

Channels are off by default for Team and Enterprise organisations. An Owner turns them on with the `channelsEnabled` managed setting. An admin can also name this plugin, `qq` from the `cc-channels` marketplace, in the organisation's `allowedChannelPlugins` setting, which lets members start it with `--channels plugin:qq@cc-channels` instead of the development flag. That setting replaces Anthropic's default list rather than adding to it, so list every Channel plugin the organisation wants, and it approves `qq` without approving any other Platform. The development flag skips only the allowlist: `channelsEnabled` still applies. See [Claude Code's Channels documentation](https://code.claude.com/docs/en/channels) for the settings' exact format.

## Development

```bash
cd plugins/qq
bun install
bun test
bun run typecheck
```

The tests run without a QQ account: the QQ connection sits behind one interface, and a fake stands in for it. The real connection is checked by hand with [docs/release-checklist.md](docs/release-checklist.md). Terms used in the code and documents are defined in [GLOSSARY.md](GLOSSARY.md).

## Licence

[Apache-2.0](LICENSE)
