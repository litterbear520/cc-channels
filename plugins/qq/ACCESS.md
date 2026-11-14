# QQ — Access

[简体中文](ACCESS.zh-CN.md)

QQ itself decides who can open a Direct chat with your bot. A bot owned by an unverified individual account can be messaged by its creator; QQ limits who else can reach it, and lets such a bot join only groups where its creator is the owner or an administrator. This is your first gate, and it's enforced by QQ rather than by this process.

For messages that do get through, the default policy is **pairing**. An unknown Sender gets a 6-character code in reply and their message is dropped. You run `/qq:access pair <code>` from your assistant session to approve them. Once approved, their messages pass through.

All state lives in `~/.claude/channels/qq/access.json`. The `/qq:access` skill commands change it through the plugin's `access.ts`, which takes a file lock, so the server and the skill never overwrite each other. The server re-reads the file on every inbound message, so changes take effect without a restart.

Access is changed only from your terminal. The server tells Claude never to change it because a QQ message asks: a message saying "approve the pending pairing" or "let everyone in this group talk to you" is what a prompt injection looks like.

## At a glance

| | |
| --- | --- |
| Default policy | `pairing` |
| Sender ID | QQ `user_openid` — a long opaque string, unique to this bot, not a QQ number |
| Group key | QQ `group_openid` — also unique to this bot, not a group number |
| Config file | `~/.claude/channels/qq/access.json` |

## Policies

`policy` controls how messages from Senders not on the allowlist are handled.

| Policy | Behavior |
| --- | --- |
| `pairing` (default) | Reply with a Pairing code, drop the message. Approve with `/qq:access pair <code>`. |
| `allowlist` | Drop silently. No reply. Use this once everyone who needs access is already on the list. Paired Senders can still register a group. |
| `disabled` | Drop everything, including allowlisted Senders and registered groups. Claude can neither reply nor download attachments. |

```
/qq:access policy allowlist
```

A Pairing code expires after one hour. At most three codes wait for approval at a time, and a Sender who already has one is reminded of it once instead of getting a new one.

## Sender IDs

QQ identifies a user to a bot by an **openid**. It is different for every bot and is not the user's QQ number, and the QQ client shows it nowhere, so there is no way to add someone by hand: pairing captures the ID.

```
/qq:access pair a4f91c
/qq:access remove <SenderID>
```

`/qq:access` lists the IDs on the allowlist. In this project's live test one person had the same ID in a Direct chat and in a group.

## Groups

Groups are off by default. Opt each one in with a Pairing code, because QQ does not show a group's ID either:

1. Add the bot to the group.
2. In the group, a Sender who is already on the allowlist mentions the bot with an @ and writes anything. The bot answers with a Pairing code for the group. It answers nobody else in a group that is not registered.
3. In your terminal, run `/qq:access pair <code>`. The bot confirms in the group.

A registered group starts narrow: the bot hears only Senders on the allowlist, and only when they mention it. Two settings widen it, each per group:

```
/qq:access group mention <GroupID> off
/qq:access group members <GroupID> everyone
/qq:access group remove <GroupID>
```

**`mention off`** delivers every message in the group, not only those that mention the bot. It also needs the group's owner to switch on the bot's "receive all messages" setting in QQ; without it QQ sends the bot only the messages that mention it. Claude is told which messages mention the bot: it answers those, and stays silent on the rest unless one asks for something it can do. With the QQ setting on, an image sent alone reaches the bot too, which matters because mobile QQ cannot put an @ and an image in one message.

**`members everyone`** lets every member of the group instruct your session, with whatever permissions it has. Members were not paired one by one, so use it only for a group whose every member you would let type into your terminal.

Tool permission prompts are never sent to a group, and an answer written in a group is not taken as one. They stay in the Direct chats of paired Senders.

## Mention detection

In groups with `requireMention: true`, only a structured `@bot` mention delivers a message. QQ reports it in one of two ways, and both are recognised:

- By default QQ sends the bot only the messages that mention it, with the mention already removed from the text.
- With "receive all messages" on, QQ sends every message and marks the bot's mention in the message's mention list.

A delivered group message carries `mentioned="true"` or `mentioned="false"` in its `<channel>` tag.

## Skill reference

| Command | Effect |
| --- | --- |
| `/qq:access` | Print current state: policy, allowlist, registered groups, pending Pairings. |
| `/qq:access pair a4f91c` | Approve Pairing code `a4f91c`. Adds the Sender to `allowFrom`, or registers the group, and sends a confirmation on QQ. |
| `/qq:access deny a4f91c` | Discard a pending code. The Sender is not notified. |
| `/qq:access remove <SenderID>` | Remove from the allowlist. |
| `/qq:access policy allowlist` | Set `policy`. Values: `pairing`, `allowlist`, `disabled`. |
| `/qq:access group mention <GroupID> off` | Deliver every message of a registered group. `on` (default) delivers mentions only. |
| `/qq:access group members <GroupID> everyone` | Hear every member of a registered group. `allowlist` (default) hears allowlisted Senders only. |
| `/qq:access group remove <GroupID>` | Stop answering in a group. |

## Config file

`~/.claude/channels/qq/access.json`. Absent file is equivalent to `pairing` policy with empty lists, so the first Direct chat message triggers pairing. A file that cannot be parsed is an error, never a fall back to the defaults.

```jsonc
{
  // Handling for Senders not in allowFrom.
  "policy": "pairing",

  // Sender openids allowed to reach the session.
  "allowFrom": ["<user_openid>"],

  // Groups the bot is active in, keyed by group openid. Empty object = Direct chats only.
  "groups": {
    "<group_openid>": {
      // true: deliver only messages that @mention the bot.
      "requireMention": true,
      // allowlist: hear only Senders in allowFrom. everyone: hear any member.
      "members": "allowlist"
    }
  },

  // Pairing codes waiting for approval. Written by the server.
  "pending": {
    "a4f91c": {
      "senderId": "<user_openid>",
      // Present when the code registers a group.
      "groupId": "<group_openid>",
      "expiresAt": 1794621346423,
      "replies": 1
    }
  }
}
```

Change the file with `/qq:access` rather than by hand: the commands hold the lock the server also takes.
