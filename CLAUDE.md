# cc-channels

A Claude Code plugin marketplace: one Channel plugin per instant-messaging Platform. `plugins/qq/` is the only plugin so far.

## Commands

Run in the plugin's directory, `plugins/qq/`:

```bash
bun install
bun test            # every test, against a fake QQ; no account needed
bun run typecheck
```

Both must pass before a commit. CI runs the same.

## Conventions

- Use the terms in `GLOSSARY.md` in code, comments, and documents, and none of the words it lists under _Avoid_.
- Only the Platform's official bot API. Never copy code from a repository without a licence.
- Plugins share no code; see `docs/adr/0001-one-plugin-per-platform.md`.
- On a design question, do what the official `discord` and `telegram` Channel plugins do unless the Platform cannot.
- All of QQ's network access goes through the `QQGateway` interface in `plugins/qq/src/gateway.ts`. Tests use `test/fake-gateway.ts` and assert behaviour a Sender or Claude would observe.
- A change in behaviour comes with a test, and with the matching text in `README.md`, `ACCESS.md`, and their `.zh-CN.md` counterparts.
- Comments are in English and explain why. Error messages tell the reader what to do next.
- Never write a secret, an access token, or a real Sender or Group ID into code, tests, logs, or documents.
- Do not connect to QQ or read `~/.claude/channels/` unless the user asks for a live check.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature-slug>/`, which is not published. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
