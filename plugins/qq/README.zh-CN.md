# QQ

[English](README.md)

用一个 MCP server 把 QQ 机器人接到你的 Claude Code 上。

机器人在 Direct chat（单聊）或群里收到消息时，MCP server 把它转给 Claude，并提供回复、发图片和文件、撤回消息的工具。工具权限请求也会转到 QQ，可以在手机上批准。

只使用官方 QQ 机器人 API，由本机通过 WebSocket 主动连接 QQ：不需要公网地址、隧道或服务器。

## 前置条件

- [Bun](https://bun.sh)：MCP server 运行在 Bun 上。安装：`curl -fsSL https://bun.sh/install | bash`。已在 Bun 1.4.3 上测试。
- Claude Code，用 claude.ai 账号或 Console API key 登录。通过 Amazon Bedrock、Google Cloud 或 Microsoft Foundry 使用时没有 Channels。已在 Claude Code 2.1.322 上测试。
- 一个 QQ 账号，用来在 QQ 开放平台创建机器人。未认证的个人账号就够。

## 快速配置
> 这是单人 Direct chat 机器人的默认 Pairing 流程。群聊和多人使用见 [ACCESS.zh-CN.md](./ACCESS.zh-CN.md)。

**1. 创建 QQ 机器人。**

登录 [QQ 开放平台](https://q.qq.com)，创建一个机器人。

打开机器人的"开发设置"页。在"事件订阅与回调地址"里，把事件接收方式选为 **WebSocket**。如果控制台要求勾选订阅的事件，勾上单聊消息事件（`C2C_MESSAGE_CREATE`）。

IP 白名单留空，除非你确定本机出口地址。

> 机器人的创建者不需要额外步骤就能和自己的机器人单聊。个人账号的机器人还能被谁联系，由 QQ 限制，当前规则见 QQ 自己的文档。

**2. 复制 AppID 和 AppSecret。**

两个都在同一个"开发设置"页上，第 4 步要用。

**3. 安装插件。**

下面是 Claude Code 命令，先运行 `claude` 进入会话。

添加 marketplace（填克隆下来的本地路径，或仓库的 Git 地址），再安装插件：

```
/plugin marketplace add /path/to/cc-channels
/plugin install qq@cc-channels
```

插件第一次启动时按 lockfile 安装依赖。它不带任何 registry 配置，安装时用的是你自己的 Bun 或 npm 配置，镜像也一样。

**4. 把凭据交给 server。**

```
/qq:configure <AppID> <AppSecret>
```

会把 `QQ_BOT_APP_ID=...` 和 `QQ_BOT_APP_SECRET=...` 写进 `~/.claude/channels/qq/.env`，只有你的账号可读。不带参数的 `/qq:configure` 显示是否已配置，不会打印 AppSecret；`/qq:configure clear` 删除凭据。

> 要在一台机器上跑多个机器人（不同凭据、各自的 allowlist），给每个实例把 `QQ_STATE_DIR` 指到不同目录。

**5. 带 channel 标志重新启动。**

不带这个标志 server 不会连接。退出当前会话，重新启动：

```sh
claude --dangerously-load-development-channels plugin:qq@cc-channels
```

Channels 还是研究预览，Claude Code 只加载 Anthropic 名单上的 channel 插件。本插件不在名单上，所以不带标志启动时只会加载它的 skill，不会注册 channel，QQ 消息到不了。这个标志只在交互式会话里有效：用 `-p` 或通过 Agent SDK 时 Claude Code 会忽略它。启动时 Claude Code 会让你确认。

只有这个会话开着的时候才收得到消息。想一直在线，就把它放在一个常驻的终端里。

**6. Pairing。**

保持上一步的 Claude Code 运行，在 QQ 里给机器人发任意一条单聊消息，它会回一个 Pairing 码。机器人没反应时，先确认会话是带标志启动的。然后在 Claude Code 会话里：

```
/qq:access pair <code>
```

机器人会在 QQ 里确认。之后你发的消息就能到达 Claude。

**7. 收紧。**

Pairing 是用来拿到 ID 的。自己进来之后，切到 `allowlist`，陌生人就不会再收到 Pairing 码。可以让 Claude 做，或直接运行 `/qq:access policy allowlist`。

## 访问控制

访问策略、群聊、@ 的处理、skill 命令和 `access.json` 的结构见 **[ACCESS.zh-CN.md](./ACCESS.zh-CN.md)**。

速查：ID 是 QQ 的 **openid**（一长串不透明字符，每个机器人各不相同，不是 QQ 号；QQ 客户端里看不到，所以靠 Pairing 取得）。默认策略是 `pairing`。群需要逐个登记，每个群一个 Pairing 码。

allowlist 上的任何人都能向你的 Claude Code 会话下指令，权限与该会话相同。只给你愿意让他在你终端里打字的人做 Pairing。

## 提供给 Claude 的工具

| 工具 | 用途 |
| --- | --- |
| `reply` | 发到 Direct chat 或群。参数 `chat_id` + `text`；可选 `reply_to`（消息 ID），让回答显示为引用那条消息；可选 `files`（绝对路径）带附件，最多 10 个，每个 5 MB。文字以 Markdown 发送，超过 2000 字符自动拆分。返回已发送消息的 ID。 |
| `download_attachment` | 按消息 ID 把某条消息的全部附件下载到 `~/.claude/channels/qq/inbox/`，返回文件路径和元数据。 |
| `recall` | 撤回机器人自己发的消息，限发出后两分钟内，且只能撤回 server 本次启动以来发出的。 |

Direct chat 里收到消息后会自动显示"输入中"。QQ 群里没有这个能力。

QQ 不向机器人提供编辑消息、表情回应和查历史的接口，所以没有对应的工具。

## 附件

附件**不会**自动下载。`<channel>` 通知里列出每个附件的名字、类型和大小，Claude 真要用的时候才调用 `download_attachment(chat_id, message_id)`。文件落在 `~/.claude/channels/qq/inbox/`。下载到 25 MB 或超过两分钟就停止。

只能取近期消息的附件，重启之前的取不到：QQ 没有按 ID 取回历史消息的接口，server 把附件引用记在内存里。

发出去的文件里，`.png`、`.jpg`、`.jpeg`、`.gif` 显示为图片，GIF 会动；其他格式作为文件送达。超过 5 MB 的会被拒绝，没有实现 QQ 的分片上传。状态目录里 inbox 以外的文件（比如 `.env`）永远不会被发出去。

## 权限请求

Claude Code 的某次工具调用需要批准时，请求也会发到每个已配对 Sender 的 Direct chat。按请求里给出的 ID 回复 `yes <id>` 或 `no <id>`（也可以用 `y` / `n`）。终端里的提示照常可用，先到的回答生效。单独一个"yes"不会批准任何东西。请求不会发到群里，在群里写的回答也不算数。

## 限制

- **只支持 Direct chat 和群。** 不支持 Guild（QQ 频道）。
- **回复数量受 QQ 限制。** QQ 文档规定：对一条收到的消息，Direct chat 里 60 分钟内最多 4 条 Passive reply（被动回复），群里 5 分钟内最多 5 条。限制之内 server 发 Passive reply；超出之后改发 Proactive message（主动消息），Direct chat 的接收者可以关掉它，群则只有在群主允许机器人主动发言时才接收。所以长任务的结果可能发不回群里。发不出去时 Claude 会得知原因；消息不排队，也不重试。
- **结果不明的消息不会发第二次。** QQ 还没回应连接就断了时，消息可能已经送达也可能没有。不会再发一次，Claude 会得知这一点。
- **预期用法是一个常驻会话。** QQ 会把每条消息发给同一个机器人的所有连接。同一账号下有多个启用了本插件的 Claude Code 会话时，陌生 Sender 可能被回复不止一次。

对真实机器人的实测结果（包括 QQ 没有按文档执行限制的地方）记录在 [docs/research/qq-bot-and-channels.md](../../docs/research/qq-bot-and-channels.md)。

## 排查

- **机器人完全没反应。** 会话不是带标志启动的，或者已经退出。只有启动时的"Channels (experimental)"提示里出现 `plugin:qq@cc-channels`，channel 才算加载了。
- **会话提示 QQ 拒绝了凭据。** 重新运行 `/qq:configure <AppID> <AppSecret>`，然后重启 Claude Code：server 只在启动时读取凭据。
- **需要看连接事件。** 用 `QQ_CHANNEL_TRACE=1` 启动，例行的连接和重连会写进 server 的日志。
