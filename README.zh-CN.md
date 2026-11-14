# cc-channels

[English](README.md)

一个 Claude Code 插件 marketplace，把即时通讯 Platform 接到正在运行的 Claude Code 会话上，每个 Platform 一个插件。每个插件包含一个 Channel：一个 MCP server，负责把 Platform 上的消息推进你的会话，并让 Claude 在那里作答。

第一个插件是 `qq`，只使用 QQ 官方 Bot API。你在 QQ 的 Direct chat（单聊）里给自己的机器人发消息，消息就会到达你本机的 Claude Code 会话；Claude 的回答、图片、文件和工具权限请求都会回到同一个 Direct chat。Channel 通过 WebSocket 主动连接 QQ，不需要公网地址、隧道或服务器。

> **必须用开发标志启动 Claude Code。**
>
> ```bash
> claude --dangerously-load-development-channels plugin:qq@cc-channels
> ```
>
> Channels 还是研究预览功能，Claude Code 只加载 Anthropic allowlist 上的 Channel 插件。本项目不在这份名单上，所以正常启动时只会加载插件的 skill，不会注册它的 Channel，QQ 消息进不来。这个标志让这一个插件跳过 allowlist。它**只在交互式会话里生效**：用 `-p` 或通过 Agent SDK 启动时，Claude Code 会忽略它。启动时 Claude Code 会让你确认正在加载开发中的 Channel。

## 环境要求

- Claude Code，用 claude.ai 账号或 Console API key 登录。通过 Amazon Bedrock、Google Cloud、Microsoft Foundry 使用时没有 Channels 功能。已在 Claude Code 2.1.322 上测试。
- [Bun](https://bun.sh)。Channel 运行在它上面。已在 Bun 1.4.3 上测试。
- 一个 QQ 号，用来在 QQ 开放平台创建机器人。

## 安装和配置 `qq` 插件

### 1. 创建 QQ 机器人

1. 登录 [QQ 开放平台](https://q.qq.com)，创建一个机器人。
2. 打开机器人的"开发设置"页，记下 **AppID** 和 **AppSecret**。
3. 在"事件订阅与回调地址"里，把事件接收方式选为 **WebSocket**。如果管理端列出了可订阅的事件，勾选单聊消息事件（`C2C_MESSAGE_CREATE`）。
4. IP 白名单留空，除非你清楚自己机器的出口地址。

未认证的个人账号就够用：机器人的创建者可以直接和自己的机器人单聊，不需要额外步骤。个人主体的机器人能和哪些人单聊，QQ 另有限制，以 QQ 官方文档的现行规则为准。

### 2. 添加 marketplace 并安装插件

克隆本仓库，然后在 Claude Code 里执行：

```
/plugin marketplace add /path/to/cc-channels
/plugin install qq@cc-channels
```

`/plugin marketplace add` 也接受仓库托管处的 Git 地址。

插件第一次启动时会按 lockfile 安装依赖。它不自带任何 registry 配置，安装时用的是你自己的配置。需要镜像的话，在你自己的 Bun 或 npm 配置里设置，例如 `~/.bunfig.toml`：

```toml
[install]
registry = "https://registry.npmmirror.com"
```

详见 [Bun 关于 registry 的文档](https://bun.sh/docs/install/registries)。

### 3. 保存凭证

```
/qq:configure <AppID> <AppSecret>
```

凭证写入 `~/.claude/channels/qq/.env`，只有你的账号可读。不带参数的 `/qq:configure` 显示凭证是否已设置，不会打印 AppSecret；`/qq:configure clear` 删除凭证。

### 4. 带着 Channel 启动 Claude Code

```bash
claude --dangerously-load-development-channels plugin:qq@cc-channels
```

会话启动时 Channel 就会连接 QQ，之后自动刷新 access token，断网后自动重连。如果没有凭证或 QQ 拒绝了凭证，会话里会收到说明，Channel 仍保持加载，所以 `/qq:configure` 还能用。Channel 只在启动时读取凭证：改过凭证后要重启 Claude Code。

只有这个会话开着时消息才进得来。想一直在线，就把它放在持久终端里运行。

### 5. Pairing（配对）

1. 在 QQ 的 Direct chat 里给机器人发任意一条消息，它会回一个 Pairing 码。
2. 在 Claude Code 终端里批准：

   ```
   /qq:access pair <code>
   ```

3. 机器人在 Direct chat 里确认。之后你的消息就会进入会话。

Pairing 码一小时后过期。同时最多有三个码等待批准；已经有码的 Sender 再发消息只会被提醒一次原来的码，不会拿到新码。

### 6. 管理访问权限

| 命令 | 作用 |
| --- | --- |
| `/qq:access` | 显示访问策略、allowlist 上的 Sender 和待批准的 Pairing 码 |
| `/qq:access pair <code>` | 批准一个 Pairing |
| `/qq:access deny <code>` | 丢弃一个待批准的 Pairing |
| `/qq:access remove <SenderID>` | 把一个 Sender 移出 allowlist |
| `/qq:access policy pairing` | 陌生 Sender 会收到 Pairing 码（默认） |
| `/qq:access policy allowlist` | 忽略陌生 Sender。配置完成后建议切到这个策略 |
| `/qq:access policy disabled` | 忽略所有 Sender，Claude 也不能回复或下载附件 |
| `/qq:access group mention <GroupID> on\|off` | 已登记的群是只在 @机器人 时响应（`on`，默认），还是响应每条消息 |
| `/qq:access group members <GroupID> allowlist\|everyone` | 已登记的群是只听 allowlist 上的 Sender（默认），还是听所有群成员 |
| `/qq:access group remove <GroupID>` | 不再响应某个群 |

访问权限只能在你的终端里修改。Channel 会告诉 Claude：绝不因为 QQ 消息的要求而修改它。

allowlist 上的任何人都能向你的 Claude Code 会话下指令，权限与该会话相同。只给你愿意让他在你终端里打字的人做 Pairing。

### 7. 在群里使用（可选）

1. 把机器人加进一个 QQ 群。未认证的机器人只能加入创建者是群主或管理员的群。
2. 在群里 @机器人 并随便写点什么。你必须已经在 allowlist 上；在未登记的群里，机器人不回应其他任何人。它会回一个这个群的 Pairing 码。
3. 在终端里运行 `/qq:access pair <code>`。机器人会在群里确认。

刚登记的群范围很窄：机器人只听 allowlist 上的 Sender，而且只在被 @ 时响应。`/qq:access` 会列出已登记的群和它们的 Group ID，上面的 `group` 命令要用到这个 ID。

- **想不 @ 也被听到**，需要群主在 QQ 里打开机器人的"接收全部消息"设置，然后你运行 `/qq:access group mention <GroupID> off`。不开 QQ 的这个设置，QQ 只把 @机器人 的消息发给它。Claude 会得知哪些消息 @ 了机器人：这些它会回答，其余的保持安静，除非消息在请求它能做的事。打开 QQ 的设置之后，单独发的图片也能到达机器人；手机 QQ 不能把 @ 和图片放在同一条消息里，所以这一点有用。
- **`/qq:access group members <GroupID> everyone` 会让群里每个成员都能向你的会话下指令**，权限与该会话相同。群成员没有逐个做过 Pairing，所以只对"每个成员你都愿意让他在你终端里打字"的群使用。
- 工具权限请求不会发到群里，在群里写的回答也不会被当作批准。它们只在已配对 Sender 的 Direct chat 里进行。

## 在 QQ 里能做什么

- **发文字。** 消息进入会话时带有你的 Sender ID、消息 ID 和时间。
- **发图片或文件。** Claude 能看到消息带了附件，需要时再下载到 `~/.claude/channels/qq/inbox/`。附件一超过 25 MB 就停止下载，最多只取这么多；超过两分钟没下完也会放弃。
- **引用之前的消息。** Claude 能同时看到被引用的文字和你写的内容。
- **知道消息已送达。** 消息到达 Claude 后，机器人会显示一会儿"输入中"。
- **看 Claude 的回答。** Claude 通过 Channel 的 `reply` 工具作答。文字以 Markdown 发送，超过 2000 个字符会拆成多条消息。Claude 可以让回答以引用你近期某条消息的形式显示。
- **接收图片和文件**，每个不超过 5 MB。
- **回答工具权限请求。** Claude Code 的某次工具调用需要批准时，请求会发给每个已配对的 Sender。按请求里给出的 ID 回复 `yes <id>` 或 `no <id>`（也可以用 `y` / `n`）。终端里的提示照常可用，先到的回答生效。单独一个"yes"不会被当作批准。机器人会确认收到了你的回答。

## 限制

- **支持 Direct chat 和群聊。** 不支持 Guild（QQ 频道）。
- **给群的回答要快。** QQ 文档规定，机器人对一条群消息最多能在 5 分钟内发 5 条 Passive reply。超出之后 Channel 改发 Proactive message，而群只有在群主允许机器人主动发言时才接收；在本项目的实机测试里，打开这个设置之前 QQ 拒绝了它（"主动消息失败, 无权限"）。所以长任务的结果可能发不回群里，发不出去时 Claude 会得知。机器人在群里不显示"输入中"，因为 QQ 在群里没有这个能力。
- **不能编辑消息、不能加表情回应、不能查历史。** QQ 不向机器人提供这些能力。Claude 要更正时会另发一条新消息，也无法查看更早的消息。
- **文件最大 5 MB。** 更大的文件会被拒绝；没有实现 QQ 的分片上传。
- **Passive reply 的限制。** QQ 文档规定，机器人对一条收到的消息最多能在 60 分钟内发 4 条 Passive reply（被动回复）。Channel 遵守这两个限制：在限制之内，对你最近一条消息发 Passive reply；超出之后改发 Proactive message（主动消息），而 QQ 允许接收者关闭主动消息。两种都发不出去时，Claude 会得知原因；消息不会排队，也不会事后重试。QQ 还没回应连接就断了时，消息可能已经送达也可能没有：不会再发一次，Claude 会得知这一点。在本项目的实机测试里，唯一的 Sender 是机器人的创建者，这两个限制都没有生效（同一条消息收下了 39 条 Passive reply，最后一条在 61 分钟之后），Sender 关闭主动消息后 Proactive message 仍然送达。其他 Sender 可能会受到文档所写限制的约束。
- **只能取回近期消息的附件。** QQ 没有按消息 ID 取回历史消息的接口，所以 Channel 把近期消息的附件引用记在内存里，重启后就没有了。
- **预期用法是一个常驻会话。** QQ 会把每条消息发给同一个机器人的所有连接。只有带标志启动的会话会收到消息，但如果同一账号下有多个启用了本插件的 Claude Code 会话，陌生 Sender 可能被回复不止一次。

## Team 和 Enterprise

Team 和 Enterprise 组织默认关闭 Channels，需要 Owner 用托管设置 `channelsEnabled` 打开。管理员还可以把本插件（`cc-channels` marketplace 里的 `qq`）写进组织的 `allowedChannelPlugins` 设置，成员就能用 `--channels plugin:qq@cc-channels` 启动，不再需要开发标志。这项设置会整体替换 Anthropic 的默认名单，而不是在其上追加，所以要把组织需要的每个 Channel 插件都列进去；这样批准 `qq` 并不会同时批准其他 Platform。开发标志只跳过 allowlist，`channelsEnabled` 仍然适用。设置的具体格式见 [Claude Code 的 Channels 文档](https://code.claude.com/docs/en/channels)。

## 开发

```bash
cd plugins/qq
bun install
bun test
bun run typecheck
```

测试不需要 QQ 账号：与 QQ 的连接放在一个接口后面，测试时用假的实现代替。真实连接按 [docs/release-checklist.md](docs/release-checklist.md) 手工检查。代码和文档里的术语定义在 [GLOSSARY.md](GLOSSARY.md)。

## 许可证

[Apache-2.0](LICENSE)
