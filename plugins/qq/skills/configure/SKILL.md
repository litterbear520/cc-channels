---
name: configure
description: Set up the QQ channel's bot credentials. Use when the user pastes a QQ AppID and AppSecret, asks how to set up QQ, wants to check whether the channel is configured, or wants the credentials removed.
argument-hint: "[<AppID> <AppSecret> | clear]"
user-invocable: true
allowed-tools:
  - Bash(bun ${CLAUDE_PLUGIN_ROOT}/configure.ts *)
---

# /qq:configure — QQ Channel Setup

Stores the QQ bot's credentials in `~/.claude/channels/qq/.env`, where the
channel server reads them when it starts.

All reading and writing goes through one command:

```
bun ${CLAUDE_PLUGIN_ROOT}/configure.ts <status | set <AppID> <AppSecret> | clear>
```

Use it, and do not read, print, or edit the `.env` file yourself: the command
never prints the stored AppSecret, and it makes the file readable by the
user's account only. Never repeat the AppSecret back to the user.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args — status and guidance

Run `configure.ts status` and tell the user what it shows. It prints whether
credentials are set and the AppID, never the AppSecret.

End with the next step for their state:

- **Not set** → *"Run `/qq:configure <AppID> <AppSecret>`. Both are on the QQ
  open platform (q.qq.com), in your bot's 开发设置 page."*
- **Set** → *"Start Claude Code with `claude
  --dangerously-load-development-channels plugin:qq@cc-channels` to connect."*
  If the session was told that QQ rejected the credentials, say so and have
  them check both values in the console.

### `<AppID> <AppSecret>` — save them

1. The arguments are two values separated by whitespace: the AppID (digits)
   first, then the AppSecret. If there is only one value, or they look
   swapped, ask instead of guessing.
2. Run `configure.ts set <AppID> <AppSecret>`.
3. Tell the user the credentials are saved and that the server reads them only
   when it starts, so they need to restart Claude Code.

### `clear` — remove the credentials

Run `configure.ts clear` and confirm they are removed. The bot stays connected
until the session restarts.

---

## Notes

- A missing state directory or file means "not configured", not an error.
- In the QQ open platform console the bot's event delivery must be set to
  WebSocket. If the channel connects but no message ever arrives, that switch
  is the first thing to check.
