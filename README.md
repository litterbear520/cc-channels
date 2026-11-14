# cc-channels

[简体中文](README.zh-CN.md)

A Claude Code plugin marketplace that connects instant-messaging Platforms to a running Claude Code session, one plugin per Platform.

Each plugin contains one Channel: a local MCP server that pushes the Platform's messages into your session and lets Claude answer there. The Channel dials out from your machine, so you need no public URL, tunnel, or server.

> **⚠️ You must start Claude Code with a development flag.** Channels are a research preview, and Claude Code loads only the Channel plugins on Anthropic's allowlist. These plugins are not on that list. Start Claude Code as each plugin's README shows, for example:
>
> ```bash
> claude --dangerously-load-development-channels plugin:qq@cc-channels
> ```
>
> A Channel hands messages from outside to an agent that has your machine's permissions. Read a plugin's access documentation before you let anyone but yourself reach it.

## Plugins

| Plugin | Platform | What it does | Docs |
| --- | --- | --- | --- |
| [`qq`](plugins/qq) | QQ, through the official QQ Bot API | Direct chats and groups: text, images and files both ways, quoting, recall, and tool permission prompts answered from QQ | [README](plugins/qq/README.md) · [Access](plugins/qq/ACCESS.md) |

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
│   └── release-checklist.md
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

The tests run without an account on the Platform: the connection sits behind one interface, and a fake stands in for it. The real connection is checked by hand with [docs/release-checklist.md](docs/release-checklist.md). Terms used in the code and documents are defined in [GLOSSARY.md](GLOSSARY.md).

## Licence

[Apache-2.0](LICENSE)
