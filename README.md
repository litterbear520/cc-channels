# cc-channels

[简体中文](README.zh-CN.md)

[![test](https://github.com/litterbear520/cc-channels/actions/workflows/test.yml/badge.svg)](https://github.com/litterbear520/cc-channels/actions/workflows/test.yml) [![licence](https://img.shields.io/badge/licence-Apache--2.0-blue)](LICENSE)

A Claude Code plugin marketplace that connects instant-messaging Platforms to a running Claude Code session, one plugin per Platform.

Each plugin contains one Channel: a local MCP server that pushes the Platform's messages into your session and lets Claude answer there. The Channel dials out from your machine, so you need no public URL, tunnel, or server.

> **⚠️ You must start Claude Code with a development flag.** Channels are a research preview, and Claude Code loads only the Channel plugins on Anthropic's allowlist. These plugins are not on that list. Start Claude Code as each plugin's README shows, for example:
>
> ```bash
> claude --dangerously-load-development-channels plugin:qq@cc-channels
> ```
>
> A Channel hands messages from outside to an agent that has your machine's permissions. Read a plugin's access documentation before you let anyone but yourself reach it.

## How it works

```
 your phone                         your machine
┌──────────┐   Platform's    ┌────────────────────────────────────────┐
│ QQ chat  │◄───bot API─────►│ Channel (MCP server) ◄─stdio─► Claude  │
└──────────┘                 │  access gate · reply tools      Code   │
                             └────────────────────────────────────────┘
```

1. You write to your bot. The Channel, already connected to the Platform, receives the message.
2. The Channel checks who wrote it. Only a Sender you have paired gets through, unless you opened a group to all its members; anyone else gets a Pairing code, or nothing.
3. The message appears in your session as a `<channel>` event. Claude works on it with the tools and permissions that session has.
4. Claude answers with the Channel's `reply` tool, and the answer appears in the chat. A tool call that needs your approval can be approved from the chat too.

Nothing runs in the cloud: the Channel lives and dies with the Claude Code session that started it.

## Plugins

| Plugin | Platform | What it does | Docs |
| --- | --- | --- | --- |
| [`qq`](plugins/qq) | QQ, through the official QQ Bot API | Direct chats and groups: text, images and files both ways, quoting, recall, and tool permission prompts answered from QQ | [README](plugins/qq/README.md) · [Access](plugins/qq/ACCESS.md) |

More Platforms are being looked at. Whether one can be built on its official bot API is written up before any code: see [WeChat](docs/research/wechat-bot-and-channels.md) and [WeCom](docs/research/wecom-bot-and-channels.md), both in Chinese and neither tried against a real account yet. To ask for another, open a [Platform request](https://github.com/litterbear520/cc-channels/issues/new?template=platform_request.yml).

## Installation

In Claude Code, add this marketplace, then install a plugin from it:

```
/plugin marketplace add litterbear520/cc-channels
/plugin install qq@cc-channels
```

Then follow the plugin's own README for its credentials and Pairing.

## Structure

```
cc-channels/
├── .claude-plugin/
│   └── marketplace.json     # The marketplace: one entry per plugin
├── plugins/
│   └── qq/
│       ├── .claude-plugin/
│       │   └── plugin.json  # Plugin metadata
│       ├── .mcp.json        # Starts the Channel
│       ├── server.ts        # The Channel's entry point
│       ├── src/             # The Channel, one module per concern
│       ├── skills/          # /qq:configure and /qq:access
│       ├── test/
│       ├── README.md
│       └── ACCESS.md
├── docs/
│   ├── adr/                 # Architecture decisions
│   ├── research/            # What was checked against the real Platform
│   ├── release-checklist.md
│   └── README.md            # What each document is
└── GLOSSARY.md              # The terms used in code and documents
```

Plugins share no code: each one stands alone and can be installed, versioned, and removed by itself. See [ADR 0001](docs/adr/0001-one-plugin-per-platform.md).

## Team and Enterprise

Channels are off by default for Team and Enterprise organisations. An Owner turns them on with the `channelsEnabled` managed setting. An admin can also name a plugin of this marketplace in the organisation's `allowedChannelPlugins` setting, which lets members start it with `--channels plugin:qq@cc-channels` instead of the development flag. That setting replaces Anthropic's default list rather than adding to it, so list every Channel plugin the organisation wants. The development flag skips only the allowlist: `channelsEnabled` still applies. See [Claude Code's Channels documentation](https://code.claude.com/docs/en/channels) for the settings' exact format.

## Development

```bash
cd plugins/qq
bun install
bun test
bun run typecheck
```

The tests run without an account on the Platform: the connection sits behind one interface, and a fake stands in for it. The real connection is checked by hand with [docs/release-checklist.md](docs/release-checklist.md). Terms used in the code and documents are defined in [GLOSSARY.md](GLOSSARY.md). See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## Licence

[Apache-2.0](LICENSE)
