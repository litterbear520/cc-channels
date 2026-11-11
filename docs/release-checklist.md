# Release checklist for the `qq` plugin

The automated tests replace QQ with a fake, so they cannot show that the real connection works. Run this checklist by hand against a real QQ bot before a release, and record the outcome at the end of this file.

Never paste an AppSecret, an access token, or a real person's Sender ID into this file, a ticket, or a screenshot.

## Before you start

- A QQ bot whose event delivery is set to WebSocket, and its AppID and AppSecret.
- Bun and Claude Code installed.
- A phone or desktop QQ client signed in as someone who can open a Direct chat with the bot.
- `cd plugins/qq && bun test && bun run typecheck` passes.

## Steps

Tick each step, or write what happened instead.

### Install

- [ ] 1. `/plugin marketplace add <path or Git URL>` adds the `cc-channels` marketplace.
- [ ] 2. `/plugin install qq@cc-channels` installs the plugin with no manual dependency step.

### Configure

- [ ] 3. `/qq:configure` reports that no credentials are set.
- [ ] 4. `/qq:configure <AppID> <AppSecret>` saves them. `/qq:configure` then shows the AppID and never the AppSecret.
- [ ] 5. `ls -l ~/.claude/channels/qq/.env` shows mode `-rw-------`.

### Connect

- [ ] 6. Start `claude --dangerously-load-development-channels plugin:qq@cc-channels`. The "Channels (experimental)" notice names `plugin:qq@cc-channels`, and no connection problem is reported in the session.
- [ ] 7. With wrong credentials stored, the session is told that QQ rejected them and `/qq:configure` still works. Restore the right ones and restart.

### Pairing

Start from a state in which the Sender is not on the allowlist (`/qq:access remove <SenderID>` if needed).

- [ ] 8. A Direct chat message to the bot is answered with one Pairing code, in Chinese, and nothing appears in the session.
- [ ] 9. `/qq:access` lists the pending code. `/qq:access pair <code>` approves it, and within a few seconds the bot confirms in the Direct chat.
- [ ] 10. `/qq:access` lists the Sender on the allowlist.

### Text both ways

- [ ] 11. A text message from the paired Sender appears in the session as a `qq` channel message.
- [ ] 12. Claude answers with the `reply` tool, and the answer appears in the Direct chat with its Markdown rendered (try bold, a list, and a code block).
- [ ] 13. Ask for an answer of more than 2000 characters. It arrives as several messages, in order, with nothing missing.

### Attachments both ways

- [ ] 14. Send the bot an image. The session shows an attachment count; ask Claude to look at it, and it downloads the image into `~/.claude/channels/qq/inbox/` and describes it.
- [ ] 15. Send the bot a file. Claude downloads and reads it the same way.
- [ ] 16. Ask Claude to send back a `.png` or `.jpg` from disk. It is displayed as an image in the Direct chat.
- [ ] 17. Ask Claude to send back another kind of file, such as a `.txt`. It arrives as a file with its own name and opens.
- [ ] 18. Ask Claude to send a file larger than 5 MB. It reports the limit and sends nothing.
- [ ] 19. Ask Claude to send `~/.claude/channels/qq/.env`. It is refused.

### Permission relay

Run the session without bypassing permissions, so that a tool call asks for approval.

- [ ] 20. Ask Claude, from QQ, to do something that needs approval. The prompt arrives in the Direct chat in Chinese with the tool name, a description, and a five-letter ID.
- [ ] 21. Answer `yes <id>` in QQ. The tool call goes ahead, and the answer does not show up in the session as a message.
- [ ] 22. Trigger another prompt and answer `no <id>`. The call is denied.
- [ ] 23. Trigger another prompt and answer it in the terminal instead. That works.
- [ ] 24. Send a bare `yes`. It arrives as an ordinary message and approves nothing.

### Access policies

- [ ] 25. `/qq:access policy allowlist`, then message the bot from a Sender who is not paired (or after `/qq:access remove`): no reply at all.
- [ ] 26. `/qq:access policy disabled`: a paired Sender's message is neither delivered nor answered. Set the policy back afterwards.

## Record of runs

### 2026-11-11, partial

Bot owned by an unverified individual account; the only Sender was the bot's creator. Claude Code 2.1.322, Bun 1.4.3, macOS. Steps were run across tickets 02 to 08 as each part was built, not in one pass, and some with a script standing in for Claude Code.

| Steps | Outcome |
| --- | --- |
| 1, 2 | Passed in ticket 02, with the marketplace added from the local path. |
| 3 to 6 | Passed in ticket 03. |
| 7 | Not run against the real bot. |
| 8 to 10 | Passed in ticket 04, with a script standing in for Claude Code. |
| 11 | Passed in a real session started with the flag. |
| 12, 16, 17 | QQ accepted a Markdown message, a `.png` image, and a `.txt` file sent by the `reply` tool, with a script standing in for Claude Code, all as Proactive messages. How they displayed in the QQ client has not been confirmed. |
| 13 to 15, 18 to 26 | Not run. |

Later the same day, in a real session started with the flag, the maintainer reported:

| Steps | Outcome |
| --- | --- |
| 11, 12 | A message sent from QQ was answered by Claude in the Direct chat. Whether the Markdown test of step 12 (bold, a list, a code block) was tried is not recorded. |
| 16, 17 | The image and the file arrived in the QQ client and displayed normally. |

Still not run: 7, 13 to 15, and 18 to 26.
