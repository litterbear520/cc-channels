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
- [ ] 18. Ask Claude to send a file larger than 25 MB. It reports the limit and sends nothing.
- [ ] 18a. Ask Claude to send a file of between 5 MB and 25 MB, and an image of that size. Both arrive and open.
- [ ] 19. Ask Claude to send `~/.claude/channels/qq/.env`. It is refused.

### Permission relay

Run the session without bypassing permissions, so that a tool call asks for approval.

- [ ] 20. Ask Claude, from QQ, to do something that needs approval. The prompt arrives in the Direct chat in Chinese with the tool name, a description, a five-letter ID, and an 允许 and a 拒绝 button.
- [ ] 21. Answer `yes <id>` in QQ. The tool call goes ahead, and the answer does not show up in the session as a message.
- [ ] 22. Trigger another prompt and answer `no <id>`. The call is denied.
- [ ] 23. Trigger another prompt and answer it in the terminal instead. That works.
- [ ] 24. Send a bare `yes`. It arrives as an ordinary message and approves nothing.
- [ ] 24a. Trigger another prompt and press 允许. The tool call goes ahead, the button reads 已选：允许, and no further message arrives. Trigger one more and press 拒绝: the call is denied.

### Access policies

- [ ] 25. `/qq:access policy allowlist`, then message the bot from a Sender who is not paired (or after `/qq:access remove`): no reply at all.
- [ ] 26. `/qq:access policy disabled`: a paired Sender's message is neither delivered nor answered. Set the policy back afterwards.

### Group chat

Needs a QQ group the bot can join, and for steps 30 and 31 a second member who is not on the allowlist. `docs/research/qq-bot-and-channels.md`, section D10, records what was seen in a real group so far.

- [ ] 27. In a group that is not registered, a paired Sender mentions the bot and is answered with one Pairing code. `/qq:access pair <code>` registers the group, and the bot confirms in the group.
- [ ] 28. A mention from the paired Sender appears in the session with `chat_type="group"` and `mentioned="true"`, and Claude's answer appears in the group.
- [ ] 29. A message without a mention is not delivered. After the group's owner switches on "receive all messages" in QQ and `/qq:access group mention <GroupID> off`, it is delivered with `mentioned="false"`, and Claude stays silent on small talk.
- [ ] 30. A member who is not on the allowlist mentions the bot: nothing is delivered and nothing is answered.
- [ ] 31. After `/qq:access group members <GroupID> everyone`, that member's message is delivered. Set it back to `allowlist` afterwards.
- [ ] 32. Trigger a permission prompt from the group. It arrives in the Direct chat only, and `yes <id>` written in the group approves nothing.
- [ ] 33. Send an image and a file in the group; Claude downloads and reads them. Ask for an image and a file back; they display in the group.

### Recall, GIF and QQ emoji

- [ ] 34. Ask Claude to take back the message it just sent. It disappears from the chat in the QQ client. Check a Direct chat and a group.
- [ ] 35. Ask again for a message older than two minutes. Claude reports that it is too late, and the message stays.
- [ ] 36. Ask Claude to send a `.gif` from disk. It plays as an animation. Check a Direct chat and a group.
- [ ] 37. Send a QQ emoji and a sticker. Each reaches the session as its name in brackets, such as `[捂脸]`.

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
| 11, 12 | A message sent from QQ was answered by Claude in the Direct chat, and Markdown rendered. |
| 13 | An answer of more than 2000 characters arrived as several messages. |
| 14 to 17 | Images and files worked in both directions and displayed normally. |

Not run, by the maintainer's decision to deal with them if a problem shows up: 7 and 18 to 26, which include the size-limit and state-directory refusals, the whole permission relay, and the allowlist and disabled policies. Those are covered by the automated tests only.

After the session was restarted with the code for quoting, typing status, and quoted messages, the maintainer reported three further checks as passed. They are not numbered steps of this checklist:

| Check | Outcome |
| --- | --- |
| Typing status | A message sent from QQ showed the typing status in the Direct chat. |
| Quoted inbound message | A message quoting an earlier one reached Claude with the quoted text. |
| `reply_to` | An answer that quoted the Sender's message displayed as a quote in the QQ client. |

### 2026-11-14, partial, Group chat

One group, in which the only member writing was the bot's creator, who owns the group. Steps 27 to 37 were added to this checklist after these checks, so they were run as the features were built and not in one pass.

| Steps | Outcome |
| --- | --- |
| 27, 28 | Passed in a real session. |
| 29 | Delivery without a mention passed once "receive all messages" was on. Staying silent on small talk was not checked on purpose. |
| 33 | Passed: an image and a file from the group were downloaded and read, and an image and a file were sent back. |
| 34 | QQ accepted the recall of a group message from a script. The `recall` tool, a Direct chat, and the message disappearing in the client are not confirmed. |
| 36 | A `.gif` sent to the group played as an animation. Not checked in a Direct chat. |
| 30 to 32, 35, 37 | Not run. Covered by the automated tests only. |

### 2026-11-14 and 2026-11-16, partial, permission buttons and large files

Run with scripts standing in for Claude Code, against the bot's creator in a Direct chat. Steps 20 and 24a were changed and step 18a was added with these features.

| Steps | Outcome |
| --- | --- |
| 20, 24a | A permission prompt arrived with both buttons. Pressing 允许 returned an allow verdict for the request, and the button read 已选：允许. Pressing 拒绝 on a real prompt, and a real session that is not bypassing permissions, were not run. |
| 18a | QQ accepted a 12 MB `.txt`, uploaded in two parts, and a 6.4 MB `.png`, both through the plugin's own gateway. How they displayed in the QQ client has not been confirmed. A group was not checked. |
| 18 | Not run. Covered by the automated tests only. |
