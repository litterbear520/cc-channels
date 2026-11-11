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

未认证的个人账号就够用：机器人的创建者可以直接和自己的机器人单聊，不需要额外步骤。个人主体的机器人能被哪些人私聊，QQ 另有限制，以 QQ 官方文档的现行规则为准。

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
| `/qq:access policy disabled` | 忽略所有 Sender |

访问权限只能在你的终端里修改。Channel 会告诉 Claude：绝不因为 QQ 消息的要求而修改它。

allowlist 上的任何人都能向你的 Claude Code 会话下指令，权限与该会话相同。只给你愿意让他在你终端里打字的人做 Pairing。

## 在 QQ 里能做什么

- **发文字。** 消息进入会话时带有你的 Sender ID、消息 ID 和时间。
- **发图片或文件。** Claude 能看到消息带了附件，需要时再下载到 `~/.claude/channels/qq/inbox/`。
- **看 Claude 的回答。** Claude 通过 Channel 的 `reply` 工具作答。文字以 Markdown 发送，超过 2000 个字符会拆成多条消息。
- **接收图片和文件**，每个不超过 5 MB。
- **回答工具权限请求。** Claude Code 的某次工具调用需要批准时，请求会发给每个已配对的 Sender。按请求里给出的 ID 回复 `yes <id>` 或 `no <id>`（也可以用 `y` / `n`）。终端里的提示照常可用，先到的回答生效。单独一个"yes"不会被当作批准。

## 限制

- **只支持 Direct chat。** 不支持群聊和 Guild（QQ 频道）。
- **不能编辑消息、不能加表情回应、不能查历史。** QQ 在 Direct chat 里不向机器人提供这些能力。Claude 要更正时会另发一条新消息，也无法查看更早的消息。
- **文件最大 5 MB。** 更大的文件会被拒绝；没有实现 QQ 的分片上传。
- **Passive reply 的限制。** QQ 文档规定，机器人对一条收到的消息最多能在 60 分钟内发 4 条 Passive reply（被动回复）。Channel 遵守这两个限制：在限制之内，对你最近一条消息发 Passive reply；超出之后改发 Proactive message（主动消息），而 QQ 允许接收者关闭主动消息。两种都发不出去时，Claude 会得知原因；消息不会排队，也不会事后重试。在本项目的实机测试里，唯一的 Sender 是机器人的创建者，这两个限制都没有生效（同一条消息收下了 39 条 Passive reply，最后一条在 61 分钟之后），Sender 关闭主动消息后 Proactive message 仍然送达。其他 Sender 可能会受到文档所写限制的约束。
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
