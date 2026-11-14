# Contributing

Thanks for looking. Issues and pull requests are welcome, in English or Chinese.

## Ground rules

- **Official APIs only.** A plugin talks to its Platform through the Platform's own documented bot API. No reverse-engineered protocols, and no code copied from repositories without a licence.
- **One plugin per Platform, and plugins share no code.** See [ADR 0001](docs/adr/0001-one-plugin-per-platform.md).
- **Follow the official Channel plugins** (`discord` and `telegram` in [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)) for layout, skills, state files, and access behaviour, unless the Platform cannot do the same.
- **Use the terms in [GLOSSARY.md](GLOSSARY.md)** in code, comments, and documents.
- **Say what was checked against the real Platform.** Tests run against a fake; what a real bot did belongs in `docs/research/` and in the record at the end of [docs/release-checklist.md](docs/release-checklist.md). Never put a secret, a token, or a real person's ID in either.

## Working on the `qq` plugin

```bash
cd plugins/qq
bun install
bun test
bun run typecheck
```

Both must pass before a pull request; CI runs the same two commands.

- The connection to QQ sits behind the `QQGateway` interface in `src/gateway.ts`. Tests drive the Channel through `test/fake-gateway.ts` and assert what a Sender or Claude would observe, not how the code is arranged.
- A change in behaviour comes with a test, and with the README or ACCESS text that describes it, in both languages.
- Comments are in English and explain why. Error messages say what to do next.

To try a change against a real bot, add the marketplace from your clone (`/plugin marketplace add /path/to/cc-channels`) and start Claude Code with the development flag shown in the [README](README.md).

## Adding a Platform

Open an issue first, with links to the Platform's bot documentation: how a bot receives messages without a public URL, how it identifies a sender, and what it limits. A new plugin lives in `plugins/<platform>/` and starts from the same skeleton as `plugins/qq/`.

## Security

Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).
