# QQ 官方 Bot 接入方式与 Claude Code channel 实现要求调研

- 调研日期：2026-11-10
- 范围：QQ 开放平台官方 Bot API（不含 OneBot / go-cqhttp 等非官方协议）；Claude Code channels（research preview）
- 资料口径：只采信一手资料（QQ 官方文档 `bot.q.qq.com/wiki`、官方 GitHub 组织 `tencent-connect`、官方 npm 包元数据、Claude Code 官方文档、本机官方插件源码）。历史文档通过 Internet Archive 对官方页面的存档读取。
- 标注约定：
  - **【文档明确】** 一手资料里有原文
  - **【推断】** 由一手资料推出，原文没有直接写
  - **【未查到】** 没有找到一手依据
- A、B、C 三节没有做实机实验，结论都是"文档/源码这么写"。2026-11-10 用一个真实机器人做了实测，结果单独记在 [D 节](#d-实测结果2026-11-10)，标注为 **【实测】**；与文档不一致的地方以 D 节为准，A 节原文保留不改。

---

## 0. 结论摘要

1. **WebSocket 仍然可用，而且是官方当前推荐给本地单机使用的方式。** "WebSocket 将下线"的印象属实但已过时：官方文档在 2024-10 至 2026-01 期间确实写着"websocket 事件推送链路将在24年年底前逐步下线"，该声明在 2026-03-08 的文档版本中已被删除；现行文档（2026-10-21）写的是"可切换 WebSocket 与 Webhook 连接方式"，并说明 WebSocket"不依赖公网服务器部署，适合个人单机使用"。没有找到一份明确写"撤销下线"的公告，这一点是由文档前后版本对比得出的。
2. **推荐 QQ 插件用 WebSocket 收消息。** 插件只需要出站连接，不需要公网入口，和官方 discord 插件的 gateway 模型一致。Webhook 需要公网 HTTPS 回调地址（端口限 80/443/8080/8443），留作可选项即可。
3. **用户要准备的东西很少：** 在 QQ 开放平台创建机器人拿到 AppID + AppSecret，在管理端"事件订阅与回调地址"里选 WebSocket。IP 白名单是可选的（不设置则不限制来源 IP）。
4. **个人可用，但范围受限。** 现行文档把开发者分为未认证 / 个人认证 / 企业认证三档；个人主体"暂不支持公开使用"，私聊要靠"内部体验号码"（最多 20 个）或管理员账号本人，群聊只能加到创建者自己是群主/管理员的群。对"自己用 Claude Code"的场景够用。
5. **回复窗口是最大的设计约束，但现在有主动消息兜底。** 被动回复：单聊 60 分钟内最多 4 次，群聊 5 分钟内最多 5 次。主动消息现行文档允许且额度宽（单聊每用户每天 1000 条，群每群每天 1000 条），但用户/群主可以关闭。这条政策在一年内反转过（2025 年文档写"主动推送能力于 2025 年 4 月 21 日起不再提供"），属于高波动项，必须实测并做降级处理。实测结果见 D3、D4：对机器人创建者本人，这些限制一条都没有触发。
6. **发送者身份用 openid，每个机器人各不相同。** 单聊用 `author.user_openid`，群聊用 `author.member_openid`。allowlist 以单聊 `user_openid` 为键是安全的；同一用户的 `member_openid` 与 `user_openid` 是否相等、是否跨群一致，新旧文档说法不一致，需要实测。
7. **discord 插件的功能里，QQ 单聊/群聊做不到的有三项：** 消息编辑、reaction、拉取历史消息（都没有对应 API）。pairing、allowlist、reply、文件附件、权限转发可行或受限可行。
8. **有可用的官方 Node.js SDK：** `@tencent-connect/qqbot-nodejs`（MIT，2026-07 首发，2026-10 仍在发版），默认 WebSocket，自带 token 刷新、重连、分片上传、被动回复限流。旧的 `bot-node-sdk`（npm `qq-guild-bot`）已于 2023 年停止更新，不要用。新 SDK 在 Bun 下实测可用（D1）。
9. **channel 侧的硬约束：** 声明 `experimental['claude/channel']`、走 stdio、`@modelcontextprotocol/sdk` 保持在 1.x（协商到协议版本 2026-07-28 的 server 不会被注册为 channel）、meta 键只能用字母数字下划线、按发送者而不是按群做鉴权。
10. **自建 marketplace 的 channel 不在 Anthropic allowlist 上**，用户必须用 `claude --dangerously-load-development-channels plugin:<name>@<marketplace>` 启动，且只在交互式会话里生效。

---

## A. QQ 官方 Bot 的接入方式

> QQ 文档在 2026 年做过大改版：目录结构、域名、频控规则都变了。下文引用的"现行文档"均为 2026-11-10 抓取的 `bot.q.qq.com/wiki`，每条都带页面上的"上次更新"日期。

### A1. 收消息方式与 WebSocket 的官方状态

**现行状态（2026-11）**

- 【文档明确】官方首页"核心亮点"："支持WebSocket、WebHook回调连接方式灵活切换"。[QQ Bot介绍与接入指南](https://bot.q.qq.com/wiki/)（上次更新 2026-10-21）
- 【文档明确】同页"8.1 事件与回调方式选择"：
  > 点击「事件订阅与回调地址」，配置接收平台事件回调通知的方式，可切换 WebSocket 与 Webhook 连接方式。
  > 👉提示：切换后立刻生效，请谨慎操作，避免影响在线服务。
  > WebSocket：不依赖公网服务器部署，适合个人单机使用，需维护长连接。如果你是想用于连接 OpenClaw 等类似 AI Agent 服务，在 AI 服务提供方没有明确说明和指引的前提下，选用 WebSocket 即可。
  > Webhook：事件推送至你配置的 HTTPS 服务上，适合提供公开服务的机器人使用，运维更可靠。
- 【文档明确】开发文档有独立的 [WebSocket 方式](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/websocket.html) 页面（上次更新 2026-07-30），全文没有任何下线或废弃提示。
- 【文档明确】官方 Node.js SDK 的默认 transport 是 WebSocket："WebSocket (default) — long-lived connection + heartbeat + RESUME"。[tencent-connect/qqbot-nodejs README](https://github.com/tencent-connect/qqbot-nodejs)（最近提交 2026-10-12）
- 【文档明确】官方 OpenClaw 插件："By default, the plugin connects to QQ via **WebSocket** (outbound connection, no public IP required)."，Webhook 是 2026-06-05 的 1.7.2 版才新增的可选模式（"与 WebSocket 并列为两种可选传输模式"）。[tencent-connect/openclaw-qqbot README](https://github.com/tencent-connect/openclaw-qqbot)；[Agent 接入 · 插件更新日志](https://bot.q.qq.com/wiki/agent-qqbot/)（上次更新 2026-11-03）

**"WebSocket 将下线"的来龙去脉**

用同一个官方页面 `develop/api-v2/dev-prepare/interface-framework/event-emit.html` 的历史存档对比：

| 存档时间 | 页面"上次更新" | "WebSocket方式"小节下的文字 |
| :- | :- | :- |
| [2024-11-07](http://web.archive.org/web/20241107040328/https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html) | 2024-10-30 | "websocket 事件推送链路将在24年年底前逐步下线，后续官方不再维护。" |
| [2025-02-19](http://web.archive.org/web/20250219060352/https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html) | 2024-11-20 | "websocket 事件推送链路将在24年年底前逐步下线，后续官方不再维护。已接入websocket链路的机器人，请迁移至webhook链路" |
| [2025-07-11](http://web.archive.org/web/20250711025622/https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html) | 2024-11-20 | 同上 |
| [2026-01-03](http://web.archive.org/web/20260103052116/https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html) | 2024-11-20 | 同上 |
| [2026-03-26](http://web.archive.org/web/20260326232923/https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html) | 2026-03-08 | 声明已删除，小节直接从"发起连接到 Gateway"开始 |
| [现行](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html) | 2026-09-11 | 无下线声明 |

对问题的逐项回答：

- **是否属实**：【文档明确】属实。官方文档自 2024-10 起写明 WebSocket 链路"将在24年年底前逐步下线"，并要求存量机器人迁移到 webhook。
- **时间点**：【文档明确】宣布的下线时间是"24年年底前"。声明在文档里至少保留到 2026-01-03 的存档，在 2026-03-08 更新的版本里消失。
- **是否真的下线过**：【未查到】没有找到说明"2025 年期间 WebSocket 对新建或存量机器人实际不可用"的一手资料，也没有找到宣布"取消下线计划"的公告。文档只是静默删除了那句话。
- **新建机器人与存量机器人**：【文档明确】现行文档不区分新建和存量，管理端对所有机器人提供 WebSocket / Webhook 切换。【未查到】2024–2025 年间新建机器人是否被禁止选择 WebSocket。
- **今天新注册的机器人能不能用 WebSocket**：【推断】能。依据是现行首页 8.1 节把 WebSocket 作为管理端可选项并推荐给个人单机场景，且官方 SDK 与官方 OpenClaw 插件都默认使用它。没有实测。
- **文档矛盾**：旧版聚合页 `interface-framework/event-emit.html` 仍然在线（2026-09-11 更新），内容与新版三个拆分页（`event-emit/payload.html`、`webhook.html`、`websocket.html`）基本一致，没有冲突。唯一的"矛盾"是时间上的：2026-03 之前的任何博客、问答、旧 SDK README 都会告诉你 WebSocket 要下线，这些都已过时。

### A2. Webhook 方式的硬性要求

来源：[Webhook 方式](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/webhook.html)（上次更新 2026-09-11）、[安全和授权](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/sign.html)（上次更新 2024-09-12）

- **HTTPS**：【文档明确】"开发者需要提供一个 HTTPS 回调地址。"
- **端口**：【文档明确】"目前回调地址允许配置的端口号为：80、443、8080、8443。"
- **公网可达**：【推断】必须。文档没有用"公网"这个词，但事件由开放平台主动 POST 到回调地址；官方 OpenClaw 插件 README 的对比表写明 Webhook 行 "Public IP: Required"。
- **备案域名**：【未查到】现行文档没有提到域名备案或域名校验要求。是否能填裸 IP、是否要求备案，需要在管理端实际配置时确认。
- **回调地址校验流程**：【文档明确】配置回调地址后平台发来 `op: 13` 的请求，`d` 里有 `plain_token` 和 `event_ts`；服务端用 Ed25519 私钥对 `event_ts + plain_token` 签名，返回 `{"plain_token": ..., "signature": <hex>}`。请求头带 `User-Agent: QQBot-Callback` 和 `X-Bot-Appid`。
- **签名校验算法（每次回调）**：【文档明确】Ed25519。步骤：
  1. 把 AppSecret 反复拼接到至少 32 字节，取前 32 字节作为 seed（示例：secret `naOC0ocQE3shWLAfffVLB1rhYPG7` → seed `naOC0ocQE3shWLAfffVLB1rhYPG7naOC`）。
  2. 用 seed 生成 Ed25519 密钥对，取公钥。
  3. 取请求头 `X-Signature-Ed25519`（hex 解码后 64 字节）和 `X-Signature-Timestamp`。
  4. 签名体为 `timestamp + 原始 HTTP body`，用公钥验签。
- **回包格式**：【文档明确】opcode 表里有 `12 HTTP Callback ACK`，"仅用于 http 回调模式的回包，代表机器人收到了平台推送的数据"，但文档没有给出回包示例。官方 SDK 的实现是返回 HTTP 200 和 `{"op": 12, "d": 0}`（[qqbot-nodejs `src/protocol/transport/webhook.ts`](https://github.com/tencent-connect/qqbot-nodejs/blob/main/src/protocol/transport/webhook.ts)）。
- **常见故障**：【文档明确】"遇到 webhook 数据突然中断，可优先排查防火墙等网络安全设置"。[常见问题](https://bot.q.qq.com/wiki/bot_FAQ/)（上次更新 2026-11-03）
- 【未查到】回调超时时间、失败重试策略。

### A3. WebSocket 方式的流程

来源：[WebSocket 方式](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/websocket.html)（2026-07-30）、[通用数据结构](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/payload.html)（2026-07-21）、[获取通用 WSS 接入点](https://bot.q.qq.com/wiki/develop/api-v2/openapi/wss/url_get.html)（2026-07-30）。以下均为【文档明确】。

1. **取网关地址**：`GET /gateway` 返回 `{"url": "wss://api.bot.qq.com/websocket/"}`；`GET /gateway/bot` 额外返回建议分片数和 `session_start_limit`（示例里 `total: 1000`、`max_concurrency: 1`，"每个机器人创建的连接数不能超过 remaining 剩余连接数"）。
2. **建立连接**：连上后服务端先发 `op: 10 Hello`，`d.heartbeat_interval` 为心跳周期（毫秒，示例 45000）。
3. **鉴权**：客户端发 `op: 2 Identify`，`d.token` 格式为 `"QQBot {AccessToken}"`，`d.intents` 为订阅位掩码，`d.shard` 不分片时用 `[0, 1]`。成功后收到 `t: "READY"`，其中有 `session_id`。
4. **心跳**：按周期发 `op: 1`，`d` 为最近收到的序列号 `s`（首次为 `null`），服务端回 `op: 11`。
5. **重连与 resume**：断线后重新连接网关，发 `op: 6 Resume`（`token`、`session_id`、`seq`），服务端补发 `seq` 之后的事件，补发完成后下发 `t: "RESUMED"`。"断开之后短时间内重连会补发中间遗漏的事件"。
6. **服务端指令**：`op: 7 Reconnect`（要求重连）、`op: 9 Invalid Session`（identify 或 resume 参数错误）。
7. **关闭码处理**："4009 可以重新发起 resume；4914，4915 不可以连接，请联系官方解封；其他错误，请重新发起 identify"。4914 = "机器人已下架，只允许连接沙箱环境"，4915 = "机器人已封禁"，4014 = "intent 无权限"，4008 = "发送 payload 过快"。

补充：

- 【推断】access_token 两小时过期，但 Identify 之后的长连接是否随 token 过期而断开，文档没有说明；resume 时需要用当时有效的 token。官方 SDK 用后台定时刷新处理（[`src/protocol/api/token.ts`](https://github.com/tencent-connect/qqbot-nodejs/blob/main/src/protocol/api/token.ts)）。
- 【未查到】"短时间内重连会补发"的具体时间窗口。
- 【未查到】同一个机器人同时建立两条相同 shard 的连接时的行为（两个 Claude Code 会话同时启用同一个机器人时会遇到）。

### A4. 鉴权与 IP 白名单

来源：[获取访问凭证](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/access-token.html)（2026-09-16）、[API 调用指南](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/api-call-guide.html)（2026-09-17）

- **换取 token**：【文档明确】`POST https://api.bot.qq.com/app/getAppAccessToken`，JSON body `{"appId": "...", "clientSecret": "..."}`，返回 `{"access_token": "...", "expires_in": "7200"}`。
- **有效期**：【文档明确】"目前 access_token 生命周期默认 7200 秒（2 小时）"；"在有效期内重复获取会返回相同的值"；"在上一个 access_token 接近过期时间 60 秒内，获取 access_token 时，会获得一个新的 access_token，老的 access_token 在这个 60 秒内仍然有效"。
- **错误判断**：【文档明确】取 token 接口"即使调用失败，HTTP 返回码仍为 200"，要看响应体的 `code`。
- **请求头**：【文档明确】`Authorization: QQBot {ACCESS_TOKEN}`。
- **统一域名**：【文档明确】变更记录 2026-08-10："所有接口调用域名统一为 api.bot.qq.com。"[变更记录](https://bot.q.qq.com/wiki/develop/api-v2/changelog.html)
  - 冲突提示：官方 SDK 源码里取 token 的默认域名仍是 `https://bots.qq.com`，USAGE.md 里出现的 API 域名是 `https://api.sgroup.qq.com`；2026-03 的存档文档里网关地址是 `wss://api.sgroup.qq.com/websocket/`。文档更新（2026-08）比 SDK 的这部分写法新。【推断】旧域名目前仍可用（SDK 2026-10 仍在发版），以文档的 `api.bot.qq.com` 为准，旧域名是否会停用未查到。
- **旧 Token 鉴权**：【文档明确】"Token 的鉴权方式已废弃，请使用更安全的 Access Token 鉴权方式。"[启动接入](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/getting-started.html)（2026-07-21）
- **IP 白名单**：【文档明确】可选。首页 8.2 节：
  > 未设置 IP 白名单时，所有请求来源 IP 都会被允许调用，建议至少添加一条以提升安全性。
  > 设置白名单后，仅白名单地址允许调通机器人 OpenAPI，支持最多 50 个 IP 地址。

  "仅支持单个 IPv4，暂不支持 CIDR 网段。"对本地运行的插件的含义：家用宽带出口 IP 会变，用户不要设置白名单，或者自行承担维护成本。README 里要写明这一点。
- 【未查到】IP 白名单是否同时约束 WebSocket 网关连接（文档只说"调通机器人 OpenAPI"）。

### A5. 收发消息的场景、事件名与权限

来源：[消息收发概述](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html)（2026-07-21）、[通用数据结构 · 事件订阅 Intents](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/payload.html)、各事件页

| 场景 | 接收事件 | Intent | 发送接口 |
| :- | :- | :- | :- |
| 单聊（C2C） | `C2C_MESSAGE_CREATE` | `GROUP_AND_C2C_EVENT (1 << 25)` | `POST /v2/users/{user_openid}/messages`；流式 `POST /v2/users/{user_openid}/stream_messages` |
| 群聊，@ 机器人 | `GROUP_AT_MESSAGE_CREATE` | `GROUP_AND_C2C_EVENT (1 << 25)` | `POST /v2/groups/{group_openid}/messages` |
| 群聊，全量消息 | `GROUP_MESSAGE_CREATE` | `GROUP_AND_C2C_EVENT (1 << 25)` | 同上 |
| 频道，@ 机器人 | `AT_MESSAGE_CREATE` | `PUBLIC_GUILD_MESSAGES (1 << 30)` | `POST /channels/{channel_id}/messages` |
| 频道，全量消息（私域） | `MESSAGE_CREATE` | `GUILD_MESSAGES (1 << 9)` | 同上 |
| 频道私信 | `DIRECT_MESSAGE_CREATE` | `DIRECT_MESSAGE (1 << 12)` | `POST /users/@me/dms` 建会话后发送 |
| 按钮/菜单回调 | `INTERACTION_CREATE` | `INTERACTION (1 << 26)` | `PUT /interactions/{interaction_id}` 回应 |

- **群聊是否只能收到 @ 机器人的消息**：【文档明确】默认是，但现在可以开全量。[群消息（全量模式）](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html)（2026-10-21）："当机器人开启了"接收所有消息"功能后，群里的每一条消息（不限于@机器人）都会推送此事件。"开关由群主在手机 QQ 里设置（FAQ："设置接收全量消息能力：当群主设定允许该机器人接收群内全部消息时，机器人可接收到群内所有成员在群内发言消息"）。
- **@ 前缀**：【文档明确】`GROUP_AT_MESSAGE_CREATE` 的 `content`"已自动去除@机器人的前缀"（示例里前后带空格，如 `" /今日天气 "`）；全量模式下 @ 某成员会被替换为 `<@member_openid>`。
- **去重**：【文档明确】"相同 msg_id 可能多次推送"，需要去重。去重依据文档自身不一致：概述页和事件页第一句说"结合 msg_seq"，单聊事件页第二句说"结合 message_scene.ext 中的 msg_idx"。【推断】按消息 `id` 去重即可覆盖。
- **Intent 权限**：【文档明确】"除了 GUILDS，PUBLIC_GUILD_MESSAGES，GUILD_MEMBERS 事件是基础的事件，默认有权限订阅之外，其他的特殊事件，都需要经过申请才能够使用，如果在鉴权的时候传递了无权限的 intents，websocket 会报错，并直接关闭连接。"
  - 这段文字是从旧文档沿用下来的，没有说明 `GROUP_AND_C2C_EVENT` 现在是否默认开通。官方 SDK 默认一次性订阅 `GUILDS | GUILD_MEMBERS | PUBLIC_GUILD_MESSAGES | DIRECT_MESSAGE | GROUP_AND_C2C | INTERACTION`（[`src/protocol/gateway/constants.ts`](https://github.com/tencent-connect/qqbot-nodejs/blob/main/src/protocol/gateway/constants.ts)）。【推断】新建机器人默认具备这些 intent，否则官方 SDK 的默认配置会直接被断开。需要实测，并在收到 4014 时给出明确报错。
- **频道**：频道相关页面仍在文档里，但 2026 年的更新都集中在单聊和群聊。频道不是本插件的首要目标，本文不展开。

### A6. 发消息的限制

来源：[消息收发概述 · 频率与时效规则](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html)（2026-07-21）、[发送单聊消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html)（2026-10-28）、[发送群聊消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html)

**被动回复（带 `msg_id`）**【文档明确】

| 场景 | 有效期 | 每条消息可回复次数 |
| :- | :- | :- |
| 单聊 | 60 分钟 | 4 次 |
| 群聊 | 5 分钟 | 5 次 |
| 频道 / 频道私信 | 5 分钟 | 未写 |

- 原文（单聊发送页）："被动消息有效时间 60 分钟，每个消息最多回复 4 次"；（群聊发送页）："被动消息有效时间 5 分钟，每个消息最多回复 5 次"。
- 同一个 `msg_id` 多次回复要递增 `msg_seq`："相同的 msg_id + msg_seq 重复发送会失败"。
- 过期或超次的错误码：`40034005 回复消息msg_id已过期`、`40034128 被动回复时间或次数超限`、`304103 消息ID已过期，不能回复`。
- 还可以用 `event_id` 做被动回复（与 `msg_id` 二选一），单聊支持的事件是 `INTERACTION_CREATE`、`C2C_MSG_RECEIVE`、`FRIEND_ADD`。【未查到】`event_id` 的有效期。
- 文档内部矛盾两处：
  1. 单聊发送页的 `msg_id` 参数说明写"5 分钟内有效"，与同页页首及概述页的"60 分钟"冲突。官方 SDK 的限流器按 60 分钟、4 次实现（[`src/protocol/utils/reply-limiter.ts`](https://github.com/tencent-connect/qqbot-nodejs/blob/main/src/protocol/utils/reply-limiter.ts)）。
  2. 单聊次数：现行文档是 4 次；[2025-12 存档的旧文档](http://web.archive.org/web/20251227020714/https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/send.html)（上次更新 2025-12-09）是"有效时间为 60 分钟，每个消息最多回复 5 次"。以现行的 4 次为准。

**主动消息（不带 `msg_id`）**【文档明确】现行文档允许，额度如下：

| 场景 | 认证类型 | Bot 维度 | 单关系维度 | 每日上限 |
| :- | :- | :- | :- | :- |
| 单聊 | 企业 / 个人认证 | 10/qps | 20/qpm | 1000 条/用户 |
| 单聊 | 未认证 | 5/qps 且 30/qpm | 20/qpm | 1000 条/用户 |
| 群 | 企业 / 个人认证 | 60/qpm | 20/qpm | 1000 条/群 |
| 群 | 未认证 | 30/qpm | 20/qpm | 1000 条/群 |

- 前提条件：【文档明确】"QQ 用户可以在 QQ 客户端主动设置是否接收机器人发送的主动消息，如果设置了关闭，主动消息一律发送失败。"对应事件 `C2C_MSG_REJECT` / `C2C_MSG_RECEIVE`、`GROUP_MSG_REJECT` / `GROUP_MSG_RECEIVE`；错误码 `40054013 用户拒收消息`、`40034105 主动消息发送失败，无权限`、`40034100 主动消息发送超过频控限制`。群里还需要群主打开"机器人主动在群聊内发言"（[常见问题](https://bot.q.qq.com/wiki/bot_FAQ/)）。
- 互动召回消息：`is_wakeup=true`，用户与机器人对话后 30 天内分 4 个周期各可发 1 条，是主动消息被关闭时的最后手段。
- **这条政策一年内反转过**。[2025-12 存档的旧文档](http://web.archive.org/web/20251227020714/https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/send.html)写的是：
  > 主动推送能力于 2025 年 4 月 21 日起不再提供，接口调用时会收到错误信息。

  同页还保留着更早的"主动消息每月 4 条"的规则。现行的宽额度出现在 2026-07-21 更新的文档里。【未查到】恢复主动消息的公告和确切日期。

**其他限制**

- 撤回：【文档明确】机器人可撤回自己发的消息，"发送超过 2 分钟不可撤回"。
- 单条文本长度：【未查到】文档没有给出数字（只有错误码 `40054007 消息长度超限`）。官方 SDK 注释写"The QQ Open Platform caps a single text message at ~5000 characters"，常量 `TEXT_CHUNK_LIMIT = 5000`（[`src/protocol/utils/text-chunk.ts`](https://github.com/tencent-connect/qqbot-nodejs/blob/main/src/protocol/utils/text-chunk.ts)）。按 5000 字符做分片上限，需要实测。
- 内容安全：【文档明确】存在内容审核，错误码 `40034006 消息内容违规`、`1100101 安全打击：内容涉及敏感`。【未查到】发送 URL 是否仍需报备（公共错误码里保留着 `304003 URL_NOT_ALLOWED url 未报备`，但它出现在频道相关的错误码段里）。Claude 的回复里经常带链接和代码，这一点需要实测。

**对"长任务结束后还能不能把结果发回去"的回答**

- 单聊：60 分钟内用 `msg_id` 被动回复（最多 4 次，分片会消耗次数）；超时或超次后改发主动消息，前提是用户没有关闭"允许主动发送"。【推断】在现行规则下，单聊场景长任务回传是可行的。
- 群聊：被动窗口只有 5 分钟。超过后只能靠主动消息，前提是群主打开了主动发言。【推断】群聊长任务回传受限，取决于群设置。
- 设计上必须同时实现两条路径并在失败时给出可读的错误，不能假设任一条长期可用。

### A7. 发送者身份

来源：[API 调用指南 · 唯一身份机制](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/api-call-guide.html)（2026-09-17）、[单聊消息事件](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/c2c_message_create.html)（2026-09-16）、[群@机器人消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_at_message_create.html)

- **字段**：【文档明确】事件体 `author` 对象里有 `id`、`user_openid`（单聊场景使用）、`member_openid`（群聊场景使用）、`union_openid`（可能为空）、`username`、`member_role`（`member` / `admin` / `owner`）、`bot`。单聊示例里 `author.id` 与 `author.user_openid` 相同，群聊示例里 `author.id` 与 `author.member_openid` 相同。群事件另有顶层 `group_openid`。
- **是否对每个机器人唯一**：【文档明确】"不同的 bot(AppID) 获取到的用户 openid，群 openid，频道 openid 均不相同"。
- **是否稳定**：【推断】稳定。文档把它称为"用户唯一识别 openid"，发送接口以它作为路径参数，官方 OpenClaw 插件和官方 dsh 插件都把它存进白名单。文档没有出现"永久不变"之类的字样。
- **`member_openid` 是否跨群一致、是否等于 `user_openid`**：新旧文档不一致。
  - 旧版（[唯一身份机制，上次更新 2023-11-22，2026-06 存档](http://web.archive.org/web/20260616053903/https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/unique-id.html)）："相同 bot 在不同的群，获取到同一个用户在群内的唯一识别号 openid 不一样，称为 member_openid"。
  - 现行（2026-09-17）："bot 在群聊场景，获取到用户在群内的唯一识别号，称为 member_openid"，去掉了"不同的群不一样"。
  - 【未查到】现行文档没有说明两者是否相等。这直接决定"单聊里 pairing 得到的 ID 能不能用来在群里认人"，必须实测。
- **`union_openid`**：【文档明确】需要邮件申请开通，且要求机器人与 QQ 互联应用为同一主体（[常见问题](https://bot.q.qq.com/wiki/bot_FAQ/)）。未开通时为空。不适合作为 allowlist 的键。
- **用户无法自己查到 openid**：【文档明确】官方 dsh 插件 README："注意 OpenID 不是 QQ 号或群号；拿不到 OpenID 时用配对码添加。"（[tencent-connect/dsh-qqbot README](https://github.com/tencent-connect/dsh-qqbot)）。discord 插件的"开发者模式里复制用户 ID 再手动 allow"在 QQ 上没有等价操作，pairing 是添加用户的主要途径。
- **昵称**：【文档明确】单聊示例里 `username` 为空字符串，群聊示例里有值。不能依赖单聊事件里的昵称来显示"谁在说话"。

### A8. 富媒体

来源：[富媒体消息概述](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/rich-media.html)（2026-07-21）、[单聊富媒体上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_files.post.html)、[消息类型](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/type/overview.html)（2026-07-23）

**接收**【文档明确】

- 图片、视频、语音、文件都通过事件体的 `attachments` 数组到达，每项有 `url`（下载地址）、`filename`、`size`、`content_type`（`image/jpeg`、`image/png`、`image/gif`、`video/mp4`、`voice`、`file`），图片另有 `width` / `height`，语音另有 `voice_wav_url` 和 `asr_refer_text`。
- 引用消息（`message_type=103`）在 `msg_elements` 里带被引用内容。
- 【未查到】附件 `url` 的有效期，以及下载是否需要带 `Authorization`。示例 URL 带 `rkey` 参数，【推断】是有时效的签名链接，应在收到后尽快下载或在下载工具里处理过期。

**发送**【文档明确】

- 两步：先上传拿 `file_info`，再用 `msg_type=7` 且 `media.file_info` 发消息。`file_info`"有有效期（ttl），过期后需重新上传"。单聊和群聊的上传接口不互通。
- 三种上传方式：
  | 方式 | 说明 | 对本地插件的适用性 |
  | :- | :- | :- |
  | URL 上传 | 传公网 `url`，平台下载转存 | 本地文件没有公网 URL，不适用 |
  | 直接上传二进制 | `file_data` 字段，"数据大小不能超过 5M" | 适用于小文件 |
  | 分片上传 | `upload_prepare` → 逐片 PUT 到预签名 URL → `upload_part_finish` → 带 `upload_id` 调上传接口；需要整文件 MD5、SHA1 和前 10002432 字节的 MD5 | 适用，文档"推荐使用" |
- 大小限制：
  | file_type | 类型 | 格式 | 软限制 | 硬限制 |
  | :- | :- | :- | :- | :- |
  | 1 | 图片 | png / jpg | 20 MB | 200 MB |
  | 2 | 视频 | mp4 | 30 MB | 200 MB |
  | 3 | 语音 | silk | 20 MB | 200 MB |
  | 4 | 文件 | 任意 | 200 MB | 200 MB |

  "超过软限制会降级为文件类型上传，超过硬限制会报错。"
- 各场景支持：文件类型在单聊、群聊"收发 ✅"，频道 ❌。
- `srv_send_msg=true` 可上传并直接发送，但"会占用主动消息频次"。
- 【未查到】`file_data` 的编码（字段类型是 string，【推断】为 base64）。
- 文档小冲突：概述页"支持的消息类型"写图片支持 jpg/png/gif/webp/bmp，同页限制表和上传接口页写 png / jpg。
- Markdown 消息（`msg_type=2`）：【文档明确】"单聊场景、群聊场景自定义 Markdown 消息能力、消息按钮已开放到所有机器人均可使用，无需单独申请 Markdown 模版"（[常见问题](https://bot.q.qq.com/wiki/bot_FAQ/)）。Claude 的回复是 Markdown，可以直接用这个类型，支持的语法子集需要对照 [Markdown 消息](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/type/markdown.html) 页并实测。

### A9. 开发者准入

来源：[QQ Bot介绍与接入指南](https://bot.q.qq.com/wiki/)（2026-10-21）、[常见问题](https://bot.q.qq.com/wiki/bot_FAQ/)（2026-11-03）

- **个人能否注册**：【文档明确】能。"通过 QQ 账号可快捷注册 QQ 开放平台并绑定管理员，如需体验更多能力需认证主体。"个人主体认证需要实名（"姓名和身份证号码务必与手机号码对应运营商实名登记的信息一致"）。"个人主体：个人认证开发者，支持创建 5 个机器人。"
- **三档权限**：【文档明确】服务范围管理：
  > 未认证：机器人创建者仅可添加自己是群主/管理员身份的群聊。
  > 个人认证：暂不支持公开使用，机器人进群数量添加上限为 500 个。
  > 企业认证：场景均可设置为公开被使用的服务范围。
- **个人主体怎么私聊**：【文档明确】"个人主体的机器人如需添加人员私聊使用，可以在新版管理端「开发设置」中添加开发体验用户号码。""支持添加 20 个用户号码用于内部开发与内邀体验的场景；配置后不受服务范围的设置影响"。
- **沙箱**：【文档明确】新版管理端已取消沙箱："使用管理员账号进入新版机器人管理端后，管理员账号可直接测试使用，无需沙箱环境。(旧版管理端已不支持添加沙箱群\频道配置)"。不过 WebSocket 关闭码 4914 的说明里仍保留"只允许连接沙箱环境"的旧措辞。
- **上线审核**：【文档明确】"旧版管理端目前已停止审核上架、功能配置等"；首页称"机器人服务范围灵活切换免审核"。企业主体打开公开服务可能遇到"新注册账号审核预计3天完成"。
- **未认证账号能不能私聊机器人**：【未查到】文档只写了未认证账号的群聊范围，没有写单聊。【推断】创建者本人（管理员账号）可以直接私聊测试，依据是 FAQ"管理员账号可直接测试使用"。需要实测。
- **封禁风险**：【文档明确】"机器人封禁处罚是依据平台规则执行，暂不支持解封"；AI 输出"违规使用会导致机器人或相关账号封禁"。这是把 Claude 的输出发到 QQ 时用户要承担的风险，README 里要说明。
- **扫码取凭证**：【文档明确】官方提供 `@tencent-connect/qqbot-connector`，在终端展示二维码，用户用手机 QQ 扫码后自动拿到 AppID 与 AppSecret（[Agent 接入 · 第三方 Agent 接入](https://bot.q.qq.com/wiki/agent-qqbot/)）。npm 元数据显示该包 license 为 `UNLICENSED`、无公开仓库，开源项目不宜依赖它；是否使用留给设计阶段决定。

### A10. 官方 SDK（Node.js / TypeScript）

GitHub 与 npm 元数据于 2026-11-10 查询。

| 包 / 仓库 | 许可证 | 状态 | 说明 |
| :- | :- | :- | :- |
| [`@tencent-connect/qqbot-nodejs`](https://www.npmjs.com/package/@tencent-connect/qqbot-nodejs)（[仓库](https://github.com/tencent-connect/qqbot-nodejs)） | MIT | 在维护：npm 首发 2026-07-13，最新 1.0.5，仓库最近提交 2026-10-12 | "protocol-level client for the QQ Open Platform (HTTP + WebSocket Gateway, message + media + streaming)"。TypeScript，纯 ESM，要求 Node >= 20，唯一运行时依赖 `ws`。默认 WebSocket，可选 Webhook。自带 token 管理、重连与 RESUME、分片上传、被动回复限流、C2C 流式消息、消息去重、`accessPolicy` 白名单中间件。可以只用 `/protocol` 子入口（`ApiClient`、`TokenManager`、`GatewayConnection`）。 |
| [`qq-guild-bot`](https://www.npmjs.com/package/qq-guild-bot)（[tencent-connect/bot-node-sdk](https://github.com/tencent-connect/bot-node-sdk)） | MIT | 已停更：仓库最近推送 2023-11-29，npm 最后修改 2022-06 | 面向频道的旧 SDK。官方"启动接入"页的 SDK DEMO 列表仍然链接到它，该列表没有跟上新 SDK。 |
| [`@tencent-connect/openclaw-qqbot`](https://github.com/tencent-connect/openclaw-qqbot) | 仓库 MIT（npm 元数据未填 license） | 在维护：最近推送 2026-10-12 | 官方 OpenClaw channel 插件，基于上面的新 SDK。不是 SDK，但它是"把 QQ Bot 接到本地 agent"的一手参考实现。 |
| [tencent-connect/dsh-qqbot](https://github.com/tencent-connect/dsh-qqbot) | MIT | 在维护：最近推送 2026-11-08 | 官方 DeepSeek Harness 插件，走 WebSocket，有配对码和 OpenID 白名单，和本项目要做的东西形态最接近。 |
| [tencent-connect/botgo](https://github.com/tencent-connect/botgo)、[botpy](https://github.com/tencent-connect/botpy) | Apache-2.0 / MIT | 最近推送 2024-12 / 2024-09 | Go 与 Python SDK，仅作对照。 |

- 【文档明确】官方文档对 SDK 的定位："SDK 仅提供接入参考，详情能力以官方文档能力描述为准"。
- 【未查到】`@tencent-connect/qqbot-nodejs` 在 Bun 下的兼容性（官方只声明 Node >= 20）。
- 第三方 npm 包 `qq-bot-sdk` 是 AGPL-3.0，与本仓库的 Apache-2.0 不兼容，不要引入。

---

## B. Claude Code channels 的实现要求

资料：[Channels reference](https://code.claude.com/docs/en/channels-reference)、[Channels](https://code.claude.com/docs/en/channels)、[Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)、[Plugin loading reference](https://code.claude.com/docs/en/plugins/loading.md)、[Host and maintain a marketplace](https://code.claude.com/docs/en/plugins/host-marketplace.md)、[MCP](https://code.claude.com/docs/en/mcp.md)，均于 2026-11-10 抓取。本机官方插件源码位于 `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/discord/`（下文简称 `discord/`）。

### B1. 必须满足

| # | 要求 | 依据 |
| :- | :- | :- |
| 1 | **声明 channel 能力**：`capabilities.experimental['claude/channel']`，值恒为 `{}`。 | "Required. Always `{}`. Presence registers the notification listener." [channels-reference · Server options](https://code.claude.com/docs/en/channels-reference#server-options)；`discord/server.ts:443-454` |
| 2 | **走 stdio**：Claude Code 把 server 作为子进程启动，通过 stdin/stdout 通信。stdout 只能出现 MCP 协议内容，日志写 stderr。 | "Connect over stdio transport" [channels-reference · What you need](https://code.claude.com/docs/en/channels-reference#what-you-need)；`discord/server.ts:723`；官方插件所有日志都用 `process.stderr.write` |
| 3 | **用 `notifications/claude/channel` 推事件**：`params.content` 是字符串正文，`params.meta` 是可选的 `Record<string, string>`。 | [channels-reference · Notification format](https://code.claude.com/docs/en/channels-reference#notification-format)；`discord/server.ts:875-887` |
| 4 | **meta 键只能是标识符**：字母、数字、下划线。 | "Keys must be identifiers: letters, digits, and underscores only. Keys containing hyphens or other characters are silently dropped."（同上）。值必须是字符串，官方插件用 `String(atts.length)`（`discord/server.ts:885`） |
| 5 | **按发送者鉴权，不按群**：在调用 `mcp.notification()` 之前检查发送者是否在 allowlist。 | "Gate on the sender's identity, not the chat or room identity ... gating on the room would let anyone in an allowlisted group inject messages into the session." [channels-reference · Gate inbound messages](https://code.claude.com/docs/en/channels-reference#gate-inbound-messages) |
| 6 | **双向 channel 要声明 `capabilities.tools: {}` 并注册 reply 工具**（普通 MCP tool，没有 channel 专属之处）。 | [channels-reference · Expose a reply tool](https://code.claude.com/docs/en/channels-reference#expose-a-reply-tool)；`discord/server.ts:520-543`、`605-656` |
| 7 | **MCP SDK 留在 1.x，不能协商到协议版本 2026-07-28**。 | "On the v2 runtime, a channel server that negotiates MCP protocol revision 2026-07-28 can't deliver channel messages, so Claude Code doesn't register it as a channel. A channel server that doesn't support that revision connects on the earlier handshake and registers as before." [mcp · Push messages with channels](https://code.claude.com/docs/en/mcp.md#push-messages-with-channels) |
| 8 | **只有认证了回复者身份才能声明 `claude/channel/permission`**。 | "Only declare the capability if your channel authenticates the sender, because anyone who can reply through your channel can approve or deny tool use in your session." [channels-reference · Add relay to a chat bridge](https://code.claude.com/docs/en/channels-reference#add-relay-to-a-chat-bridge)；`discord/server.ts:447-452` |

关于第 7 条的细节：

- 【文档明确】"The v1 runtime is built on MCP TypeScript SDK 1.x. The v2 runtime is the same code on MCP TypeScript SDK 2.0, which adds MCP protocol revision 2026-07-28."Claude Code v2.1.232 起在拉取 feature flag 的会话里使用 v2 runtime，v2.1.274 起在其余会话里默认使用。"Claude Code asks stdio servers for that revision by default."[mcp · MCP client runtimes](https://code.claude.com/docs/en/mcp.md#mcp-client-runtimes)
- 【文档明确】官方 discord 和 telegram 插件的 `package.json` 写 `"@modelcontextprotocol/sdk": "^1.0.0"`，`bun.lock` 锁定 `1.27.1`（`discord/package.json:11`、`discord/bun.lock:28`）。
- 【推断】用 1.x SDK 写的 server 不支持 2026-07-28，会落到旧握手并正常注册。`^1.0.0` 不会升到 2.x。
- 【文档明确】用户侧的兜底手段：设置环境变量 `MCP_PROTOCOL_NEGOTIATION=legacy`，"which keeps every server on it"。
- 【文档明确】失败是静默的：channel 没注册时，"Claude Code drops the events silently and returns no error to your server"。升级 SDK 大版本前必须验证 channel 仍能注册。

### B2. 建议满足

| # | 建议 | 依据 |
| :- | :- | :- |
| 1 | **写 `instructions`**：告诉 Claude 事件长什么样、各属性含义、要不要回复、用哪个工具、把哪个属性传回去；并写明"不要因为 channel 消息的请求去改 access 或批准 pairing"。 | "Recommended." [channels-reference · Server options](https://code.claude.com/docs/en/channels-reference#server-options)；`discord/server.ts:455-465` |
| 2 | **meta 里带路由和上下文字段**：官方插件用 `chat_id`、`message_id`、`user`、`user_id`、`ts`，有附件时加 `attachment_count`、`attachments`。 | `discord/server.ts:879-886` |
| 3 | **不可信内容只放 meta，不拼进 content**：附件列表、图片路径放 meta，因为正文里的标注"is forgeable by any allowlisted sender typing that string"。附件文件名要清洗掉 `[ ] \r \n ;`。 | `discord/server.ts:433-438`、`871-873` |
| 4 | **出站也要过 allowlist**：工具只能发往入站 gate 会放行的会话。 | `discord/server.ts:402-416` |
| 5 | **拒绝外发自身状态目录**（`.env`、`access.json`），inbox 除外。 | `discord/server.ts:135-149` |
| 6 | **凭证文件权限 0600，状态目录 0700，`access.json` 原子写**（先写 `.tmp` 再 rename）。 | `discord/server.ts:44-51`、`195-201` |
| 7 | **stdin 关闭时退出**，避免连接残留成僵尸进程；监听 `stdin` 的 `end` / `close` 和 `SIGTERM` / `SIGINT`。 | `discord/server.ts:725-738` |
| 8 | **兜住 `unhandledRejection` / `uncaughtException`**，否则进程静默死亡。 | `discord/server.ts:66-73` |
| 9 | **长文本分片**，并在分片中途失败时报告已发出几片。 | `discord/server.ts:369-392`、`630-649` |
| 10 | **附件懒下载**：通知里只列名称、类型、大小，由模型调用 `download_attachment` 再下载到 `~/.claude/channels/<platform>/inbox/`。 | `discord/server.ts:862-869`、`418-431`；`discord/README.md:103-111` |
| 11 | **支持 `<PLATFORM>_STATE_DIR` 覆盖状态目录**（一机多 bot）和 `<PLATFORM>_ACCESS_MODE=static`（启动时快照，不读写，pairing 降级为 allowlist）。 | `discord/server.ts:37`、`54`、`174-189`；`discord/README.md:60` |
| 12 | **事件投递没有确认**：`await mcp.notification()` 只代表写进了 transport。Claude 忙时多条通知会在下一轮一起送达。需要送达确认就自己维护状态。 | [channels-reference · Notification format](https://code.claude.com/docs/en/channels-reference#notification-format) |

### B3. 通知格式

- 【文档明确】事件以 `<channel source="..." key="value" ...>正文</channel>` 的形式进入 Claude 的上下文，"The `source` attribute is set automatically from your server's configured name"。
- 文档与官方插件的小出入：discord 插件的 instructions 写 `<channel source="discord" ...>`（`discord/server.ts:458`），而 Channels 文档说通过插件加载时"the model receives it as a `<channel source="plugin:fakechat:fakechat">` event, using the plugin's scoped server name"（[channels · Quickstart](https://code.claude.com/docs/en/channels#quickstart)）。【推断】QQ 插件装成插件后 `source` 会是 `plugin:<plugin>:<server>` 形式，instructions 里不要把 `source` 的值写死成判断条件。需要实测确认。

### B4. reply 工具

- 【文档明确】最小形态：工具名 `reply`，参数 `chat_id` + `text`，返回 `{ content: [{ type: 'text', text: 'sent' }] }`。
- 官方 discord 插件暴露 5 个工具（`discord/server.ts:520-599`，说明见 `discord/README.md:90-98`）：
  | 工具 | 参数 | 行为 |
  | :- | :- | :- |
  | `reply` | `chat_id`、`text`，可选 `reply_to`、`files`（绝对路径，最多 10 个，每个 25MB） | 自动分片，附件挂在第一片，返回消息 ID |
  | `react` | `chat_id`、`message_id`、`emoji` | 加表情回应 |
  | `edit_message` | `chat_id`、`message_id`、`text` | 编辑机器人自己发的消息，用于进度更新 |
  | `fetch_messages` | `channel`，可选 `limit`（默认 20，上限 100） | 拉历史，旧到新 |
  | `download_attachment` | `chat_id`、`message_id` | 下载某条消息的附件到 inbox |
- 工具失败时返回 `isError: true` 和可读的错误文本，不抛异常（`discord/server.ts:714-720`）。
- 【文档明确】终端里用户看得到入站消息，看不到回复正文，只看到工具调用和"sent"。[channels](https://code.claude.com/docs/en/channels)
- 【文档明确】`reply` 工具本身也会触发权限提示（[channels-reference · Full example](https://code.claude.com/docs/en/channels-reference#full-example) 的演练里，弹出的是 `mcp__webhook__reply` 的提示）。README 里要引导用户允许该工具，否则每次回复都要人工批准。

### B5. 发送者鉴权与 pairing 的具体实现

**状态文件** `~/.claude/channels/discord/access.json`（`discord/server.ts:105-121`，`discord/ACCESS.md:106-143`）：

```jsonc
{
  "dmPolicy": "pairing",          // pairing | allowlist | disabled
  "allowFrom": ["<senderId>"],    // 允许私聊的用户 ID
  "groups": { "<channelId>": { "requireMention": true, "allowFrom": [] } },
  "pending": { "<code>": { "senderId": "...", "chatId": "...", "createdAt": 0, "expiresAt": 0, "replies": 1 } }
}
```

文件不存在等价于 `pairing` + 空名单。server 每条入站消息都重读一次，所以 skill 改完立即生效（`discord/skills/configure/SKILL.md:98-99`）。文件损坏时改名为 `.corrupt-<ts>` 并从默认值启动（`discord/server.ts:166-171`）。

**入站 gate**（`discord/server.ts:236-294`）：

1. `dmPolicy === 'disabled'` → 丢弃一切。
2. 私聊：发送者在 `allowFrom` → 投递；`allowlist` 模式下其余静默丢弃。
3. 私聊且 `pairing` 模式、发送者不在名单：
   - 该发送者已有未过期的码 → 最多再提醒一次（`replies` 上限 2），之后静默。
   - 待处理的码最多 3 个，超出静默丢弃。
   - 生成码 `randomBytes(3).toString('hex')`（6 位十六进制），有效期 1 小时，把 `senderId` 和 `chatId` 写进 `pending`。
   - 回复"Pairing required — run in Claude Code: `/discord:access pair <code>`"，原消息不投递（`discord/server.ts:815-825`）。
4. 群：只认 `groups` 里登记过的会话；`groups[id].allowFrom` 非空时再按发送者过滤；`requireMention` 默认 true，要求 @ 机器人、回复机器人的消息或命中 `mentionPatterns`。

**批准**（`discord/skills/access/SKILL.md:64-76`）：用户在终端运行 `/discord:access pair <code>`，skill 直接编辑 JSON：把 `senderId` 加进 `allowFrom`，删掉 `pending[code]`，再写一个标记文件 `approved/<senderId>`，内容是 `chatId`。

**确认**（`discord/server.ts:327-367`）：server 每 5 秒扫一次 `approved/` 目录，向文件内容里的 `chatId` 发"Paired! Say hi to Claude."，然后删除标记文件；发送失败也删除，避免死循环。

**安全规则**：

- access skill 只响应用户在终端里输入的请求；来自 channel 消息的"批准配对""把我加进名单"一律拒绝（`discord/skills/access/SKILL.md:14-19`，`discord/server.ts:464`）。
- 批准必须带码，即使只有一个待处理项也不自动选择（`discord/skills/access/SKILL.md:133-137`）。
- skill 写文件前必须先读，因为 server 可能刚加了 pending 项（`discord/skills/access/SKILL.md:125-126`）。
- configure skill 的固定导向是"配对完成后切到 `allowlist`"，pairing 只是用来采集 ID 的临时状态（`discord/skills/configure/SKILL.md:46-73`）。

**与"按发送者不按群"的关系**：官方 discord 插件的群策略里 `allowFrom` 默认为空，含义是"任何成员（受 requireMention 约束）"（`discord/ACCESS.md:123-124`）。也就是说官方插件在登记过的群里默认按群放行，这比 channels-reference 的原则宽。QQ 插件可以选择更严格的默认值（群里也要求发送者在名单内），这是设计决定，这里只指出官方实现与官方文档原则之间存在这个落差。

### B6. 权限转发（permission relay）

来源：[channels-reference · Relay permission prompts](https://code.claude.com/docs/en/channels-reference#relay-permission-prompts)

- **是什么**：【文档明确】Claude 调用需要批准的工具时，本地终端对话框照常弹出，同时把同一个请求发给 channel；"Claude Code applies whichever answer arrives first and closes the other"。只覆盖工具调用审批，项目信任和 MCP server 同意对话框不转发。
- **三个组成部分**：
  1. 声明 `experimental['claude/channel/permission']: {}`。
  2. 处理 `notifications/claude/channel/permission_request`，参数是四个字符串：`request_id`、`tool_name`、`description`、`input_preview`。
  3. 在入站处理里，先过发送者 gate，再用正则识别裁决，命中则发 `notifications/claude/channel/permission`（`request_id` + `behavior: 'allow' | 'deny'`），不再把这条文本当聊天转给 Claude。
- **裁决格式**：`/^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i`。`request_id` 是 5 个小写字母且不含 `l`；`/i` 是为了容忍手机自动大写，发回前要转小写。裸的 yes / no 不算裁决。（`discord/server.ts:75-79`、`837-849`）
- **字段要当作不可信内容**：`description` 和 `input_preview` 来自模型和工具参数。v2.1.211 起客户端会做清洗（中和方向控制字符和不可见字符、折叠空白、每个字段最多 3500 码点），v2.1.234 起还会把可识别的凭证替换成 `[REDACTED]`，但文档仍要求"Treat both fields as untrusted unless you control the client fleet"。`description` 对 Bash 可能只是常量 `Run shell command`，要尽量展示 `input_preview`。
- **版本要求**：v2.1.234 起，"sends permission requests only to servers it registered as channels for the session"；同一版本起把 `'claude/channel/permission': false` 当作未声明。
- **裁决无效的三种原因**：格式不匹配（落回普通消息）、ID 不对（静默丢弃）、ID 与本会话更早的请求重复（静默丢弃）。
- **官方 discord 插件的做法**：
  - 只发给 `access.allowFrom` 里的用户私聊，不发群（`discord/server.ts:472-475`："Groups are intentionally excluded ... Anyone in access.allowFrom already passed explicit pairing; group members haven't."）。
  - 用按钮（See more / Allow / Deny），按钮的 customId 带 `request_id`；点击时再次校验点击者在 `allowFrom` 内；裁决后把按钮替换成结果，防止重复作答（`discord/server.ts:486-516`、`744-803`）。
  - 同时保留文本路径"yes xxxxx"，命中后给那条消息加 ✅ / ❌ 回应（`discord/server.ts:837-849`）。
- 【文档明确】测试权限对话框时要切到 manual 模式，auto 模式下由分类器决定，不会弹框。

### B7. 插件打包与依赖安装

**官方 discord 插件的打包方式**

- `.claude-plugin/plugin.json` 只有 `name`、`description`、`version`、`keywords`（`discord/.claude-plugin/plugin.json`）。它**没有**使用 manifest 的 `channels` 字段和 `userConfig`。
- `.mcp.json` 用 `bun run --cwd ${CLAUDE_PLUGIN_ROOT} --shell=bun --silent start` 启动（`discord/.mcp.json:5`）；`package.json` 的 `start` 脚本是 `bun install --no-summary && bun server.ts`（`discord/package.json:8`），即每次启动先自己装依赖。telegram 版本写成 `bun install --no-summary 1>&2 && bun server.ts`，把安装输出重定向到 stderr，避免污染 stdout 上的 MCP 流。QQ 插件应照 telegram 的写法。
- 凭证不走 `userConfig`，而是由 `/discord:configure <token>` 写进 `~/.claude/channels/discord/.env`，server 启动时自己读，已有的环境变量优先（`discord/server.ts:42-51`；`discord/skills/configure/SKILL.md:75-84`）。源码注释："Plugin-spawned servers don't get an env block — this is where the token lives."`.env` 只在启动时读一次，改完要重启会话或 `/reload-plugins`。

**manifest 的 `channels` 字段**（官方插件没用，但文档提供）

- 【文档明确】"`channels` declares the message channels a plugin provides ... When you declare one, Claude Code can prompt for the channel's configuration when the plugin is enabled."每项是严格对象：`server`（必填，对应 `mcpServers` 里的键）、`displayName`、`userConfig`。未知键会导致插件加载失败。[plugins-reference · Channels](https://code.claude.com/docs/en/plugins-reference#channels)
- 【文档明确】`userConfig` 的值通过 `${user_config.KEY}` 代入 MCP server 的 `env`；`sensitive: true` 的值存进系统安全存储而不是 `settings.json`。`userConfig` 的键只能是字母数字下划线且不能以数字开头。
- 对 QQ 插件的含义：AppID / AppSecret 可以照 discord 用 configure skill 写 `.env`，也可以用 `channels[].userConfig` 让 Claude Code 弹配置框。两条路文档都支持；前者与官方插件一致。

**环境变量**

- 【文档明确】MCP stdio server 的 `command`、`args`、`env` 里可用 `${CLAUDE_PLUGIN_ROOT}`、`${CLAUDE_PLUGIN_DATA}`、`${CLAUDE_PROJECT_DIR}`，进程环境里也有这三个变量。`CLAUDE_PLUGIN_OPTION_<KEY>` 只导出给 hook 进程，MCP server 拿不到，要用 `${user_config.KEY}` 写进 `env`。[plugins-reference · Environment variables](https://code.claude.com/docs/en/plugins-reference#environment-variables)
- 【文档明确】"`${CLAUDE_PLUGIN_ROOT}` changes when the plugin updates, so don't write state there."持久数据放 `${CLAUDE_PLUGIN_DATA}`，或者像官方插件那样放 `~/.claude/channels/<platform>/`。

**缓存拷贝**

- 【文档明确】市场插件在安装时被复制到 `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` 并从副本加载。"Files outside the plugin directory aren't copied, so when a script inside a copied plugin reads a path above the plugin root, such as `../shared`, it doesn't find them."[plugins/loading · In-place and copied plugins](https://code.claude.com/docs/en/plugins/loading.md)
- 【文档明确】例外：从本地路径添加的 marketplace 里的相对路径插件"loads in place"，不复制，改源码后下次启动或 `/reload-plugins` 生效。这是本仓库开发时的形态，与用户安装后的形态不同，两种都要测。
- 【文档明确】版本号决定是否更新：manifest 里写死 `"version"` 会让用户停在缓存副本上，直到版本字符串变化；不写则按 commit SHA。
- 【文档明确】旧版本目录在更新或卸载 14 天后清理。

**同一 marketplace 内用 symlink 共享文件**

- 【文档明确】复制到缓存时，symlink 按目标位置处理：指向插件目录内 → 保留为相对 symlink；指向**同一 marketplace 的其他位置** → 解引用，把目标内容复制进缓存；指向 marketplace 之外 → 跳过。[host-marketplace · Share files within a marketplace with symlinks](https://code.claude.com/docs/en/plugins/host-marketplace.md)
- 【文档明确】限制："For plugins installed from a local path, or from a `command` source whose `mode` is the default `copy`, Claude Code preserves only symlinks that resolve within the plugin's own directory and skips all others."
- 【文档明确】Windows 上建 symlink 要用提升权限的命令提示符 `mklink /D` 或开启开发者模式。
- 【推断】`plugins/qq/core -> ../../packages/core` 这种做法在"从 git 托管的 marketplace 安装"时可行（解引用复制），在"从本地路径安装"时会被跳过。"installed from a local path"与上一节"loads in place"两种说法如何对应，文档没有讲清楚，需要实测。

**Node 依赖自动安装的限制**

- 【文档明确】只有插件根目录同时有 `package.json` 和受支持的 lockfile 才会安装。lockfile 决定包管理器：`bun.lock` → Bun；`npm-shrinkwrap.json` / `package-lock.json` → npm。`bun.lockb`、`yarn.lock`、`pnpm-lock.yaml` 会被跳过。`bun.lock` 的 `lockfileVersion` 不能高于 2（discord 的是 1）。包管理器从用户 PATH 里找，缺了不会换另一个。[plugins/loading · Node.js package dependencies](https://code.claude.com/docs/en/plugins/loading.md)
- 【文档明确】限制清单：
  - 只支持 registry 包，且 lockfile 里锁定精确版本；"A plugin with a git, GitHub, folder, workspace, or linked dependency gets no install."
  - 下载链接必须是 https。
  - 在独立目录里安装，不读插件的 `.npmrc`、`.env`、`bunfig.toml`。
  - 冻结解析；`package.json` 与 lockfile 的依赖不一致则跳过。
  - `--ignore-scripts`：不跑生命周期脚本，需要编译的原生模块装不上。
  - 不支持 npm `overrides` 和 Bun `patchedDependencies`。
  - 60 秒超时。
  - 无法关闭。
- 【文档明确】原地加载的本地 marketplace 插件不会被自动装依赖："Claude Code doesn't install the dependencies into the source directory. Install them there yourself"。
- 【推断】官方插件在 `start` 脚本里自己跑 `bun install`，所以不依赖上述自动安装也能工作；这个 `bun install` 在 `${CLAUDE_PLUGIN_ROOT}` 里执行，会读插件自带的 `.npmrc`（`discord/.npmrc` 把 registry 固定为 `https://registry.npmjs.org/`）。国内网络下访问 npmjs.org 可能慢或失败，这是面向国内用户的插件要额外考虑的问题。
- 对依赖选型的含义：QQ 插件的依赖必须全部是 registry 包、没有原生编译步骤。`@tencent-connect/qqbot-nodejs` 的必需依赖只有 `ws`，满足条件；它的可选 peer 依赖 `silk-wasm`、`mpg123-decoder` 只在发语音时需要，不要引入。

### B8. 启动方式

- 【文档明确】`.mcp.json` 里有 server 不等于 channel 生效："Being in `.mcp.json` isn't enough to push messages: a server also has to be named in `--channels`."[channels · Security](https://code.claude.com/docs/en/channels#security)
- 【文档明确】官方插件：`claude --channels plugin:discord@claude-plugins-official`，可传多个，用空格分隔。
- 【文档明确】研究预览期间 `--channels` 只接受 Anthropic allowlist 上的插件（默认是 `claude-plugins-official` 里的 channel 插件），或组织 `allowedChannelPlugins` 里的。"A channel published to your own marketplace still needs `--dangerously-load-development-channels` to run ... The community marketplace is not on the channel allowlist."[channels-reference · Package as a plugin](https://code.claude.com/docs/en/channels-reference#package-as-a-plugin)
- 【文档明确】自建插件的启动命令：
  ```bash
  claude --dangerously-load-development-channels plugin:<name>@<marketplace>
  # 没有插件包装的裸 .mcp.json server
  claude --dangerously-load-development-channels server:<name>
  ```
- 【文档明确】开发标志的限制：
  - 启动时弹全屏确认，要选"I am using this for local development"。
  - 只在交互式会话生效："If you pass it in non-interactive mode with `-p` or through the Agent SDK, Claude Code ignores the flag and the channel doesn't register."
  - 逐项生效，与 `--channels` 混用时不会把豁免扩展到 `--channels` 的条目。
  - 只跳过 allowlist，组织策略 `channelsEnabled` 仍然适用。
- 【文档明确】两个标志都不出现在 `claude --help` 里。
- 【文档明确】channels 需要 claude.ai 或 Console API key 登录，Amazon Bedrock、Google Cloud Agent Platform、Microsoft Foundry 不可用。Team / Enterprise 组织默认关闭，需要 Owner 打开 `channelsEnabled`；管理员可以用 `allowedChannelPlugins` 把自建 marketplace 的插件加入组织 allowlist（会整体替换 Anthropic 的默认名单）。Pro / Max 个人用户不受这两项限制。
- 【文档明确】只有会话开着时才收得到事件；要常驻就得把 Claude Code 放在后台进程或持久终端里。
- 【文档明确】调试：`/mcp` 看 server 状态；`claude --debug ...` 后看 `~/.claude/debug/<session-id>.txt` 里的 stderr。
- 【文档明确】研究预览声明："the `--channels` flag syntax and protocol contract may change based on feedback"。

---

## C. 交叉结论

### C1. 推荐的收消息方式

**推荐 WebSocket，作为默认且首版唯一的方式。**

理由：

1. 官方现行文档把 WebSocket 定位为"不依赖公网服务器部署，适合个人单机使用"，并建议连接 AI Agent 类服务时"选用 WebSocket 即可"（A1）。这正是 Claude Code channel 插件的运行形态。
2. Claude Code 文档对聊天平台 channel 的描述是"your plugin runs locally ... No URL to expose"（[channels-reference · Overview](https://code.claude.com/docs/en/channels-reference#overview)），WebSocket 出站连接符合这个模型，和 discord 插件的 gateway 用法同构。
3. 官方 SDK、官方 OpenClaw 插件、官方 dsh 插件都默认 WebSocket（A1、A10）。
4. 用户准备工作最少：AppID、AppSecret，管理端选 WebSocket，不设 IP 白名单。

风险与对策：

- WebSocket 曾被官方宣布下线，现行状态是由文档对比推断的（A1）。对策：把"事件来源"做成可替换的一层（入站事件统一成同一个结构再进 gate），日后补 Webhook 不需要动 gate、pairing、reply。
- 管理端的 WebSocket / Webhook 是二选一开关，"切换后立刻生效"。用户如果之前把这个机器人配成了 Webhook，插件会连得上但收不到事件。configure skill 和 README 要提示检查这个开关。

**如果将来只能用 Webhook**，本地插件需要：

- 一个公网可达的 HTTPS 地址，端口是 80 / 443 / 8080 / 8443 之一（A2）。
- 插件在本机起 HTTP 监听，由隧道或反向代理把公网请求转进来。可选形态：内网穿透隧道服务、自有云主机反向代理、云函数转发。
- 对用户意味着：要有域名或隧道账号，要保持隧道常驻，回调地址变了要回管理端改并重新通过 `op: 13` 校验。国内可用的隧道服务及是否要求备案域名，本次没有查到一手依据（A2）。
- 这会显著抬高使用门槛，所以只应作为可选项。

### C2. discord 插件功能在 QQ 上的可行性

范围说明：以下针对 QQ **单聊（C2C）和群聊**。频道场景另有一套接口，不在首版范围内。

| 功能 | 结论 | 依据与做法 |
| :- | :- | :- |
| **pairing** | **可行**（单聊） | 未知发送者私聊机器人 → 收到 `C2C_MESSAGE_CREATE`，带 `author.user_openid` 和消息 `id` → 用该 `msg_id` 被动回复配对码（60 分钟内，占 4 次中的 1 次）。批准后的"Paired!"确认：discord 靠 `approved/` 标记文件里的 `chatId`；QQ 需要同时保存 `user_openid` 和原 `msg_id`，60 分钟内用被动回复，否则走主动消息（可能被用户关闭）。前提是对方能私聊到机器人：个人主体需要把对方加入"内部体验号码"（上限 20）。官方 dsh 插件也用配对码，并说明 OpenID 无法从 QQ 号得出（A7、A9）。 |
| **allowlist** | **可行**（单聊）；**受限**（群聊） | 单聊以 `author.user_openid` 为键，每个机器人唯一（A7）。群聊以 `group_openid` 登记群、以 `author.member_openid` 过滤成员；但 `member_openid` 是否等于 `user_openid`、是否跨群一致，新旧文档不一致，实测前不能假设"私聊配对过的人在群里能被认出"。另外用户没法手动查到 openid，`/qq:access allow <id>` 这条手动路径只对从日志或配对记录里拿到的 ID 有意义。 |
| **reply** | **受限** | 接口可用（`POST /v2/users/{user_openid}/messages`、`POST /v2/groups/{group_openid}/messages`）。限制：被动回复单聊 60 分钟 4 次、群聊 5 分钟 5 次；超出后要转主动消息，主动消息可被用户或群主关闭，且政策一年内反转过（A6）。需要自己维护每个会话最近的 `msg_id`、已用次数和 `msg_seq`。文本分片会消耗被动回复次数，分片上限按约 5000 字符（未经文档确认）。`reply_to` 对应 `message_reference`（用事件 `message_scene.ext` 里的 `msg_idx`）。支持 Markdown 消息（`msg_type=2`）。 |
| **文件附件** | **受限** | 收：事件 `attachments[]` 带下载 `url`，可以照 discord 做懒下载（A8）；`url` 的时效未查到，而 QQ 没有"按消息 ID 重新取消息"的接口，所以附件元数据（含 url）要在收到事件时由 server 自己缓存，`download_attachment` 从缓存里取。发：本地文件不能用 URL 上传，≤5MB 用 `file_data` 直传，更大用分片上传（要算 MD5 / SHA1 / 前 10MB MD5）；单聊和群聊上传接口不互通；`file_info` 有 TTL。每次发附件是独立的一条消息，会占被动回复次数或主动额度。一条消息不能像 Discord 那样挂 10 个附件。 |
| **消息编辑** | **不可行** | 单聊和群聊的消息接口只有 POST（发送）和 DELETE（撤回），官方文档站的页面清单里没有编辑接口（A6、[文档目录](https://bot.q.qq.com/wiki/develop/api-v2/)）。公共错误码里的"只能修改含有 keyboard 元素的消息"属于频道。近似替代：单聊用流式消息 `stream_messages`（`input_mode: replace`，同一条消息逐步更新直到 `input_state: 10`），只在单聊可用且只能在生成过程中更新；或 2 分钟内撤回重发。 |
| **reaction** | **不可行** | 【文档明确】"目前表情表态仅支持在频道内使用"（[表情表态](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/emoji.html)）；消息类型页的支持矩阵里单聊、群聊的表情表态均为 ❌。discord 的 `ackReaction`（收到即回应）和权限裁决后的 ✅ / ❌ 回应都要换做法。近似替代：单聊发"输入中"状态（`msg_type=6`，`input_notify.input_second` 最长 60 秒），群聊无替代。 |
| **拉取历史消息** | **不可行** | 单聊和群聊没有读取历史消息的接口（文档页面清单里只有发送、撤回、上传）。引用消息会在事件的 `msg_elements` 里带上被引用内容。近似替代：server 在内存或本地文件里缓存自己收到过的消息（官方 SDK 有 `historyBuffer` 中间件做同样的事），但只包含机器人在线期间收到的、且通过了平台推送条件的消息。 |
| **权限转发** | **可行**（单聊文本路径）；按钮路径待验证 | 入站：allowlist 内用户私聊发 `yes abcde` 即可被正则识别，与 discord 文本路径相同；群里 @ 机器人时 `content` 已去掉 @ 前缀且正则容忍首尾空白，但应照官方做法只在私聊里做。出站：权限请求是 Claude Code 主动发起的，不一定有可用的 `msg_id`，要么复用该用户最近一条消息的 `msg_id`（60 分钟、4 次以内），要么发主动消息；被动次数耗尽且用户关闭了主动消息时，请求发不出去，只能回终端批准。按钮：QQ 有消息按钮和 `INTERACTION_CREATE` 回调（事件示例里的按钮数据就是 `"button_data": "confirm:once"`、`"button_id": "allow-once"`），回调带 `user_openid`，可以像 discord 一样校验点击者；但自定义按钮的开放范围文档自相矛盾（消息按钮页写"【内邀开通】自定义按钮"，FAQ 写"消息按钮已开放到所有机器人均可使用"），且回调要在 3 秒内 `PUT /interactions/{id}` 回应。首版用文本路径，按钮实测后再加。 |

discord 插件里另外两个小功能：

- **typing 指示**：单聊可用 `msg_type=6` 的输入状态通知（最长 60 秒）；群聊不可行。它是一次带 `msg_id` 的发送，【未查到】是否计入被动回复的 4 次。
- **按 @ 触发的群聊**：QQ 默认就只推送 @ 机器人的群消息（`GROUP_AT_MESSAGE_CREATE`），等价于 `requireMention: true`；`--no-mention` 需要群主在手机 QQ 里打开"接收全量消息"，然后监听 `GROUP_MESSAGE_CREATE`。

### C3. 对设计的直接含义

- `chat_id` 需要能区分单聊和群聊并携带对应的 openid，因为两者的发送和上传接口路径不同；发送还需要 `msg_id`，所以 server 要维护"会话 → 最近入站消息 ID、收到时间、已回复次数"的状态，不能像 discord 那样只凭 `chat_id` 发送。
- 工具集建议收缩为 `reply`（含文件）和 `download_attachment`；`react`、`edit_message`、`fetch_messages` 在 QQ 上没有对应能力，不要暴露空壳工具，并在 `instructions` 里告诉 Claude 没有历史查询和编辑。
- `instructions` 里要写明回复窗口：长任务结束后的回复可能失败，失败时工具返回的错误文本要说明原因（窗口过期、次数用尽、用户关闭主动消息）。
- README 的准备步骤：注册开放平台 → 创建机器人 → 记下 AppID / AppSecret → 事件订阅选 WebSocket → 不设 IP 白名单 →（个人主体）把自己的 QQ 号加进内部体验号码 → 用开发标志启动 Claude Code → 私聊机器人完成 pairing → 切到 allowlist。

---

## D. 实测结果（2026-11-10）

用维护者本人创建的一个真实机器人实测，脚本在 `.scratch/qq-channel/spike/`（不随插件发布）。环境：macOS，Bun 1.4.3，`@tencent-connect/qqbot-nodejs` 1.0.5。

**读这一节之前要知道的限制**

- 只有一个发送者，而且就是机器人的创建者（管理员账号）。下面所有"没有触发限制"的结果，都可能只对创建者本人成立，对其他 Sender 是否一样没有测。
- "手机上显示成什么样"来自维护者发来的截图，由转述得到，不是脚本观察到的。
- 每项只测了一两次，没有重复验证。

### D1. 连接与 SDK

- 【实测】官方 SDK 的 low-level 入口 `@tencent-connect/qqbot-nodejs/protocol` 在 Bun 下可用：`TokenManager` 取 token、`MessageApi.getGatewayUrl`、`GatewayConnection` 完成握手、Identify、心跳，启动后约 5 秒收到 `READY`。`MessageApi.sendRaw` 发消息、`ApiError` 的 `httpStatus` / `bizCode` / `bizMessage` 都正常。
- 【实测】新建的机器人能连 WebSocket 并收到 `C2C_MESSAGE_CREATE`。
- 【实测】Intent：只订阅 `GROUP_AND_C2C_EVENT (1 << 25)` 能通过鉴权；同时订阅 `1 << 25` 和 `INTERACTION (1 << 26)` 也能通过，都没有被 4014 断开，两个 intent 都没有事先申请。
- 【实测】`READY` 的 `d`：`version`、`session_id`、`user { id, username, bot, status }`、`shard: [0, 1]`。
- 【实测】域名：SDK 默认的 `bots.qq.com`（取 token）和 `api.sgroup.qq.com`（API、网关 `wss://api.sgroup.qq.com/websocket`）可用；文档写的 `api.bot.qq.com` 同时用于取 token 和发消息也可用。
- 【实测】网关在连接建立整 60 分钟时主动要求重连（SDK 报告 `code: 1000`、"Gateway requested reconnect"，即 `op: 7`）。SDK 自动重连并发 Resume，4 秒后收到 `RESUMED`。这是服务端的常规行为，不是故障；重连间隔只观察到这一次。
- 没有测：网络中断后的重连、Resume 是否补发断线期间的事件、token 两小时过期后的行为、`FULL_INTENTS`。同一机器人多条连接并存见 D9。

### D2. 入站事件的形状

三种消息都以 `C2C_MESSAGE_CREATE` 到达，`message_type` 都是 `0`。下面是去掉标识符后的真实事件。

文字：

```json
{
  "author": { "bot": false, "id": "<USER_OPENID>", "union_openid": "", "user_openid": "<USER_OPENID>", "username": "" },
  "content": "hello",
  "id": "<MSG_ID>",
  "message_scene": { "ext": ["msg_idx=<REFIDX>"], "source": "default" },
  "message_type": 0,
  "timestamp": "2026-11-10T18:01:28+08:00"
}
```

图片（`author`、`message_scene`、`message_type` 同上，`content` 为空字符串）：

```json
{
  "attachments": [
    {
      "content": "",
      "content_type": "image/jpeg",
      "filename": "<32 位十六进制>.jpg",
      "height": 1920,
      "width": 873,
      "size": 66614,
      "url": "https://multimedia.nt.qq.com.cn/download?appid=…&fileid=…&rkey=…&spec=…"
    }
  ],
  "content": "",
  "id": "<MSG_ID>",
  "timestamp": "2026-11-10T18:40:11+08:00"
}
```

文件（同样 `content` 为空字符串）：

```json
{
  "attachments": [
    {
      "content_type": "file",
      "filename": "example.yaml",
      "size": 2424,
      "url": "https://grouptalk.c2c.qq.com/asn.com/qqdownloadftnv5?fileType=…&isthumb=…&rkey=…&rkeycodec=…&ver=…"
    }
  ],
  "content": "",
  "id": "<MSG_ID>",
  "timestamp": "2026-11-10T18:40:08+08:00"
}
```

- 【实测】`author.id` 与 `author.user_openid` 相同；`username` 和 `union_openid` 都是空字符串。
- 【实测】消息 `id` 是以 `ROBOT1.0_` 开头的字符串，长 97 到 117 个字符，含 `.`、`-`、`!`。发送接口返回的 `id` 是同一格式。
- 【实测】图片的 `filename` 是 QQ 生成的十六进制名，不是原文件名；文件的 `filename` 是原文件名（测试里带括号）。文件附件没有 `width` / `height`，也没有 `content` 字段。
- 【实测】下载：两种 `url` 在消息到达后 30 到 40 秒用 GET 请求，带不带 `Authorization` 头都返回 200，字节数等于事件里的 `size`。图片响应 `content-type: image/jpeg`；文件响应 `content-type: application/octet-stream`，`content-disposition: attachment; filename=`（名字是空的，文件名只能取事件里的 `filename`）。
- 【实测】手机 QQ 里图片和文件各是一条独立消息，没有出现一条消息带两个附件，或文字和附件在同一条里的情况。
- 没有测：`url` 的有效期（QQ 客户端对那个文件显示"14天后到期"）、语音和视频、引用消息、文字与图片同发。

### D3. Passive reply

对同一条入站消息（下称 M）连续回复，`msg_seq` 从 1 递增：

| 距 M 到达 | 做了什么 | 结果 |
| :- | :- | :- |
| 24 秒到 2 分钟 | 连发 20 条 | 全部成功 |
| 2 到 5 分钟 | 再发 16 条（含 Markdown 和长文本） | 全部成功 |
| 35.6 分钟 | 1 条文字、1 条 Markdown | 成功，手机上正常显示 |
| 61.5 分钟 | 1 条文字（第 39 条） | 成功，手机上正常显示 |

- 【实测】文档写的"60 分钟、最多 4 次"在这次测试里没有生效：同一个 `msg_id` 一共成功回复 39 次，最后一次在 61.5 分钟。没有见到 `40034005`、`40034128`、`304103` 中的任何一个，所以"超限时返回什么错误"没有测到。
- 【实测】单聊发送页参数说明里的"5 分钟内有效"不成立。
- 【实测】重复 `msg_seq`：对同一个 `msg_id` 再用一次已用过的 `msg_seq`，返回 HTTP 400，业务码 `40054005`，消息"消息被去重，请检查请求msgseq"。
- 没有测：窗口和次数的真实上限（测到 39 次、61.5 分钟为止没有触发，没有继续往上试）；创建者以外的 Sender 是否受文档数字约束。

### D4. Proactive message

不带 `msg_id` 发送，全部成功且在手机上显示：

| 发送时的状态 | 结果 |
| :- | :- |
| 开关打开，距 Sender 上一条消息 2 分钟 | 成功 |
| 开关打开，距上一条消息 30 分钟和 34 分钟 | 成功，送达 |
| "允许主动发送消息"**关闭**，距上一条消息 4 分钟 | 成功，送达 |
| "允许主动发送消息"**关闭**，距上一条消息 23 分钟，且 Passive reply 的 60 分钟已过 | 成功，送达 |

- 【实测】Proactive message 在这个机器人上可用。
- 【实测】Sender 关闭开关后，Proactive message 仍然送达，接口没有返回 `40054013` 或 `40034105`。"关闭后一律发送失败"在这次测试里不成立，所以"被拒收时的错误"没有测到。
- 【实测】开关的位置：手机 QQ 聊天里点名字旁的机器人图标进资料页，右上角齿轮"设置"，"机器人权限设置"，"消息推送设置"下的"允许主动发送消息"。
- 【实测】关闭开关时，机器人收到的不是文档写的 `C2C_MSG_REJECT`，而是一个 `INTERACTION_CREATE`（下面是关闭时的事件）：

  ```json
  {
    "application_id": "<APP_ID>",
    "data": { "resolved": { "authorize_data": { "opt_scene": "setting", "scope": "c2c_push" } } },
    "id": "<UUID>",
    "scene": "c2c",
    "timestamp": "2026-11-10T18:44:05+08:00",
    "type": 18,
    "union_openid": "",
    "user_openid": "<USER_OPENID>",
    "version": 1
  }
  ```

  重新打开开关时收到同样的事件，`authorize_data` 里多一个 `"switch": true`；关闭时没有 `switch` 字段。收到它们时订阅了 `INTERACTION (1 << 26)`；只订阅 `1 << 25` 时会不会收到没有测。
- 没有测：Sender 沉默超过 60 分钟后的 Proactive message（上表每一条都发在 Sender 最近一条消息之后 34 分钟以内；最后一行的"60 分钟已过"只针对 D3 的那条消息 M）；频控与每日额度；创建者以外的 Sender 关闭开关后是否真的收不到。

### D5. 账号与准入

- 【实测】维护者用自己的 QQ 号登录开放平台、创建机器人，之后直接就能在手机 QQ 里和它 Direct chat，没有去添加"开发体验用户号码"，也没有其他管理端步骤。
- 【实测】维护者在管理端核实过：页面右下角显示"未认证主体"。所以未认证账号能和自己创建的机器人 Direct chat，本节其余实测结果也都是在未认证账号上得到的。
- 对本项目的含义：只给自己用时不需要做主体认证（个人认证要实名）。按 A6、A9 的文档，认证影响的是另外几件事：未认证的 Proactive message 频控更低（单聊 5/qps 且 30/qpm，认证后 10/qps）、机器人只能加进创建者自己是群主或管理员的群、给别人私聊要靠"开发体验用户号码"（上限 20）。这几条都没有实测。
- 【实测】管理端"主体认证状态"卡片显示"未认证"，卡片上的说明原文（2026-11-10 截图）：
  > 未认证：机器人仅管理员使用，可添加到管理员作为群主的群内。
  > 个人认证：可设置为公开使用，机器人进群数量添加上限为 500 个。
  > 企业认证：所有场景均可设置为公开被使用的服务范围。
  > 备注：历史通过旧版开放平台审核上架的机器人不受群上限数量影响。
- 管理端的说法与 A9 引用的文档有两处不同：管理端写个人认证"可设置为公开使用"，文档写"暂不支持公开使用"；管理端写未认证"仅管理员使用"，文档没有写未认证账号的单聊范围。哪边是现行规则没有核实，管理端更可能是新的。
- 对本项目的含义：未认证账号下，能和机器人 Direct chat 的很可能只有创建者本人。这时 Pairing 实际只会用在创建者自己身上；要让第二个人用，需要先做个人认证或走"开发体验用户号码"，两条路都没有实测。README 要写明这一点。
- 2026-11-10 晚些时候，维护者完成了个人认证，账号变为"已认证的个人开发者"。D 节的全部实测都发生在认证之前，即未认证账号上；认证之后没有重跑任何一项。此后用这个机器人做的实测都是个人认证账号的结果，未认证状态下的行为无法再用它复现。
- 没有测：不是创建者的 QQ 号给这个机器人发消息会怎样。

### D6. Markdown

- 【实测】`msg_type: 2`、`markdown: { content }` 没有申请任何权限就能发，Passive reply 和 35 分钟后的回复都成功。SDK 文档说"markdown 消息需要审核通过的特殊权限"，对这个机器人不成立。
- 【实测】手机 QQ 上渲染出来的语法：`#` 标题（大号粗体）、`**粗体**`、`*斜体*`、`` `行内代码` ``（灰底）、`-` 无序列表、围栏代码块（带语言标签、语法着色、"复制"和"全屏"按钮）、表格（带"复制""保存""全屏"按钮）。没有原样显示的 `#` 或 `**`。
- 发出去但没有看到渲染结果的语法：删除线、有序列表、引用块、链接（那条消息所在的聊天记录在查看前被删除了）。
- 没有测：把含 Markdown 语法的文本当普通文本（`msg_type: 0`）发时手机上的样子（发送成功，记录同样被删）；Markdown 消息的长度上限。

### D7. 文本长度

- 【实测】普通文本（`msg_type: 0`）的发送接口不拒绝长文本：ASCII 2000、5000、5001、6000、8000、20000、50000、200000、1000000 个字符，中文 1700、2000、5000 个字符（15000 字节），全部返回成功，从未出现 `40054007 消息长度超限`。
- 【实测】超长消息会弄坏客户端：发出 5 万、20 万、100 万字符三条之后，维护者的手机 QQ 一进这个会话就闪退，删除聊天记录后才恢复，其间复发过一次。是其中哪一条引起的不清楚。
- 没有测：哪个长度开始显示不完整或引发闪退。事故之后没有再发超过 100 字符的消息，6000 字符及以下的那些消息当时是否完整显示也没有人看过。
- 结论：长度上限要由插件自己定，不能指望平台报错。这次没有数据支持比 SDK 的 5000 更大的值。**不要重复这个实验**；`send.ts` 已把探测长度限制在 5000。

### D8. 其他

- 【实测】普通文本里带一个 `https://` 链接和一个代码块，发送成功，没有 `URL_NOT_ALLOWED` 或内容违规错误。只测了一个域名。

### D9. 同一个机器人的多条连接（2026-11-11）

脚本 `.scratch/qq-channel/spike/two-connections.ts` 在一个进程里先后开了两条连接 A、B（相隔约 12 秒），当时本机还有第三条连接（一个普通会话里的插件进程）。之后维护者在单聊里连发 3 条文字。

- 【实测】A 和 B 各自收到全部 3 条 `C2C_MESSAGE_CREATE`，同一条消息到达两条连接的时间相差 2 到 3 毫秒。QQ 是广播，和 Discord 一样，不是只投给其中一条。
- 【实测】B 连上之后 A 没有被断开，12 分钟内两条连接都没有出现断连或错误。
- 两条连接用的都是默认分片 `[0, 1]`。
- 没有测：超过三条连接、不同机器或不同出口 IP 的连接、连接数有没有上限。

对设计的含义：Claude Code 只在注册了 Channel 的那个会话里投递通知，所以一条消息只会进一个会话，不需要单实例规则。但每个连着 QQ 的插件进程都会各自处理陌生 Sender 的消息，见工单 04 的评论。

### D10. 群聊（2026-11-14）

脚本 `.scratch/qq-channel/spike/group.ts`。一个群，机器人创建者是群主，也是唯一发言的成员；机器人在群里的角色显示为管理员。每项只测了一两次。

- 【实测】默认设置下，群里 @机器人 的消息以 `GROUP_AT_MESSAGE_CREATE` 到达，`content` 已去掉 @，前面留一个空格（如 `" 你好"`）。事件带 `group_openid`、`author.member_openid`、`author.member_role`、`author.username` 和 `author.member_nickname`。
- 【实测】`author.member_openid` 与同一个人在单聊里的 `user_openid` **相同**。A7 里新旧文档不一致的那个问题，对这个机器人和这个人的答案是"相同"。只有一个人、一个群，是否对其他成员、其他群成立没有测。
- 【实测】被动回复可用：`POST /v2/groups/{group_openid}/messages` 带 `msg_id` 和 `msg_seq`，纯文本（`msg_type: 0`）和 Markdown（`msg_type: 2`）都被接受，维护者确认 Markdown 在群里正常渲染。5 分钟 5 次的上限没有去触碰。
- 【实测】主动消息（不带 `msg_id`）默认被拒绝：HTTP 400，`40034105 主动消息失败, 无权限`。群主在手机 QQ 的群设置里允许机器人主动发言之后，同样的请求成功。
- 【实测】引用：引用机器人的一条消息再 @ 它，事件的 `message_type` 是 `103`，`msg_elements[0].content` 是被引用消息的原文，`message_scene.ext` 里多一项 `ref_msg_idx=`，与单聊相同。
- 【实测】群主打开"接收全部消息"之后，群里每条消息都以 `GROUP_MESSAGE_CREATE` 到达，包括不 @ 的消息和单独发的图片；@机器人 的消息也改走这个事件，没有再收到 `GROUP_AT_MESSAGE_CREATE`。这时 @ 留在 `content` 里，写成 `<@member_openid>`，事件多一个 `mentions` 数组，机器人自己那一项带 `is_you: true`、`bot: true`。
- 【实测】群里的图片附件和单聊同形：`attachments[]` 里有 `content_type: image/jpeg`、`filename`、`size`、`width`、`height`、`url`（`multimedia.nt.qq.com.cn`）。
- 【实测】手机 QQ 不能把 @ 和图片放进同一条消息：选图片会单独发出一条不带 @ 的消息。不开"接收全部消息"时机器人收不到它。
- 【实测】群事件的 `message_scene.ext` 里还有一项 `auth_token=`，每条消息不同。文档没有说明用途，插件不使用它，脚本输出里已脱敏。
- 【实测】用插件本身在同一个群里跑通（同日稍后）：下载群消息里的图片和文件；经 `/v2/groups/{group_openid}/files` 上传后向群发送一张 JPEG 和一个 `.md` 文件，维护者确认群里显示正常；带 `message_reference` 的群回复被接受。
- 【实测】QQ 自带表情在 `content` 里写成 `<faceType=1,faceId="264",ext="eyJ0ZXh0Ijoi5o2C6IS4In0=">`，`ext` 是 base64 的 JSON `{"text":"捂脸"}`。把这段标记原样放进出站消息，Markdown（`msg_type: 2`）和纯文本（`msg_type: 0`）各发一次，接口都接受，但维护者看到的都是标记原文，没有变成表情：机器人不能用这个写法发 QQ 自带表情。通用 emoji（如 👀）显示正常。
- 【实测】一张 96×96、12 帧、约 123 KB 的 GIF，以 `file_type: 1`（图片）经 `/v2/groups/{group_openid}/files` 上传后用 `msg_type: 7` 发到群里，维护者确认显示为会动的图。上传文档列出的图片格式里没有 GIF。只测了这一张，单聊没有测。
- 【实测】撤回：`DELETE /v2/groups/{group_openid}/messages/{message_id}` 对机器人几秒前发的一条群消息返回成功（空对象）。手机上是否消失没有得到确认。
- 没有测：其他成员（非创建者）的消息、5 分钟和 5 次的被动回复上限、机器人被加进或移出群的事件、带引用的群回复在手机上是否显示为引用。

对设计的含义：allowlist 可以直接用于群成员，不需要另一套身份；插件要自己判断消息有没有 @ 机器人，不能依赖 QQ 只推送 @ 消息；给群的回答超过被动回复窗口后取决于群主的设置。

### D11. 消息按钮（2026-11-14）

脚本 `.scratch/qq-channel/spike/buttons.ts`（不随仓库发布）。同一个机器人，点按钮的是创建者本人，手机 QQ。每项只测了一次。

- 【实测】自定义按钮（`keyboard.content.rows[].buttons[]`，`action.type=1` 回调，`permission.type=2`）随 Markdown 消息（`msg_type=2`）发出，QQ 接受，没有申请过任何权限。[消息按钮](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/msg-btn.html)页面写的"【内邀开通】自定义按钮"对这个机器人不成立。单聊被动回复、群聊被动回复、单聊主动消息三种都成功。没有测 `msg_type=0` 带按钮。
- 【实测】点按钮后收到 `INTERACTION_CREATE`，`type` 和 `data.type` 都是 11，`data.resolved` 里有 `button_id` 和 `button_data`。单聊事件带 `user_openid`（`scene: "c2c"`，`chat_type: 2`），群聊事件带 `group_openid` 和 `group_member_openid`（`scene: "group"`，`chat_type: 1`）。两处的 ID 都等于这个人单聊的 `user_openid`。事件里没有被点的那条消息的 ID。
- 【实测】`PUT /interactions/{id}`，body `{"code": 0}`，成功。客户端弹出"操作成功"，按钮文字变成 `visited_label`。同一条消息上的另一个按钮之后仍然可以点。
- 【实测】用这个事件的 `id` 作 `event_id` 发被动消息被拒：`40034025 请求参数event_id无效`，单聊和群聊都是。文档（A6）说单聊支持以 `INTERACTION_CREATE` 的 `event_id` 被动回复，实测不成立，或者需要别的条件。
- 【实测】Markdown 代码块里的 `*star*`、`_under_`、`<tag>` 原样显示。
- 没有测：别人（非创建者）点按钮；`permission.type=0` 加 `specify_user_ids` 限定点击人；桌面 QQ 的显示；应答超时的时长。

对设计的含义：权限请求可以带"允许 / 拒绝"按钮，点击人的 ID 可以直接和 allowlist 比对；点击后的确认不用再发消息，按钮自己会变；QQ 没有编辑消息的接口，裁决之后按钮撤不掉，重复点击要靠 Claude Code 忽略已经结束的请求。

### D12. 分片上传（2026-11-16）

脚本 `.scratch/qq-channel/spike/chunked-upload.ts` 和 `live-large-upload.ts`（不随仓库发布）。同一个机器人，接收者是创建者本人的单聊，都是主动消息。每项只测了一次。

- 【实测】官方 SDK 的 `ChunkedMediaApi`（`upload_prepare` → PUT 到预签名地址 → `upload_part_finish` → 带 `upload_id` 调上传接口）对这个个人机器人可用，没有申请过任何权限。
- 【实测】6 MB 的 `.txt`：`upload_prepare` 返回的分片大小是 10 MB，所以只有 1 片；约 7 秒传完；返回的 `ttl` 是 86400 秒。随后用 `msg_type=7` 发出成功。
- 【实测】12 MB 的 `.txt`：2 片，约 9 秒。6.4 MB 的 `.png`（`file_type=1`）：约 3 秒。两个都经插件自己的网关上传并发出成功。
- 没有测：群聊；超过 25 MB 的文件；每日上传限额（错误码 `40093002`）什么时候触发；文件在 QQ 客户端里的显示。

对设计的含义：超过 5 MB 的文件走分片上传，上限照官方 discord 插件定为 25 MB，低于 QQ 文档里图片 30 MB、文件 100 MB 的上限。

---

## 未解决的问题

以下问题没有一手资料能回答，需要动手实验。按对设计的影响排序。2026-11-10 的实测回答了其中一部分，在各条后面标出，详情见 D 节。

1. **新注册的机器人今天能否真的连上 WebSocket 并收到 C2C 事件。** 文档指向"能"，但本次没有实测；同时确认未认证 / 个人认证账号是否默认拥有 `GROUP_AND_C2C_EVENT (1 << 25)` 和 `INTERACTION (1 << 26)` intent，没有时是否返回 4014。 **部分解决（D1）**：这个机器人能连上并收到事件，两个 intent 未申请就能订阅，没有遇到 4014；账号是未认证主体（D5）；个人认证账号没有测。
2. **`member_openid` 与 `user_openid` 的关系。** 同一个用户在单聊和群聊里的 openid 是否相同；同一个用户在两个群里的 `member_openid` 是否相同。
3. **被动回复的真实窗口和次数。** 单聊是 60 分钟还是 5 分钟（文档自相矛盾）、4 次是否准确；超限时返回哪个错误码；"输入中"状态通知和流式消息的每个分片是否计次。 **部分解决（D3）**：对创建者本人，39 次、61.5 分钟都没有触发限制，"5 分钟"不成立；真实上限、超限错误码、其他 Sender 是否受限仍未知；输入状态和流式消息没有测。
4. **主动消息在个人 / 未认证机器人上是否真的可用。** 现行文档给了额度，但 2025 年曾全面停止；用户默认是否开启"允许主动发送"；群里默认是否允许主动发言。 **部分解决（D4）**：单聊可用；维护者没有动过开关时就能送达，推断开关默认打开，没有直接看过初始状态；关闭后对创建者本人仍然送达；群聊没有测。
5. **未认证账号能否私聊自己创建的机器人**，以及不在"内部体验号码"里的 QQ 号私聊个人主体机器人时会发生什么（机器人侧是否收得到事件）。 **部分解决（D5）**：未认证账号的创建者本人能直接聊，无需管理端步骤；非创建者没有测。
6. **`@tencent-connect/qqbot-nodejs` 能否在 Bun 下运行**（官方只声明 Node >= 20）；不能的话是用 Bun 原生 WebSocket 自己实现网关，还是改用 Node 运行。 **已解决（D1）**：能在 Bun 1.4.3 下运行。
7. **同一个机器人被两个进程同时连接 WebSocket 时的行为**（两个 Claude Code 会话同时启用，或上一个会话的 server 没退干净）。 **已解决（D9）**：QQ 把同一条消息广播给每一条连接，新连接不会顶掉旧连接。
8. **入站附件 `url` 的有效期，以及下载是否需要鉴权头。** **部分解决（D2）**：不需要鉴权头；有效期没有测。
9. **`file_data` 直传的编码方式**（推测为 base64），以及本地文件走分片上传的完整流程是否对个人机器人开放。 **部分解决（D12）**：分片上传对这个机器人开放；`file_data` 是 base64，插件一直这样直传，图片和文件都送达过。
10. **单条文本和 Markdown 消息的长度上限**（SDK 注释为约 5000 字符），以及带 URL、代码块的内容是否会被内容安全拦截或要求 URL 报备。 **部分解决（D6、D7、D8）**：接口对普通文本没有长度上限（试到 100 万字符），但超长消息会让手机 QQ 闪退，上限须自定；一个链接和一个代码块没有被拦截；Markdown 消息的上限没有测。
11. **自定义消息按钮（`keyboard.content`）是否对个人机器人开放**，回调按钮（`action.type=1`）能否用于权限审批。 **已解决（D11）**：对这个机器人开放，可以用于权限审批。
12. **access_token 过期后已建立的 WebSocket 连接是否会被断开**，resume 时用新 token 是否可行，"短时间内重连补发事件"的时间窗口多长。
13. **IP 白名单是否影响 WebSocket 网关连接。**
14. **Webhook 回调地址是否要求备案域名、是否允许裸 IP、失败重试策略。**（仅在需要 Webhook 时才要查。）
15. **插件加载后 `<channel>` 标签的 `source` 实际是什么**（`qq` 还是 `plugin:qq:qq`）。
16. **marketplace 内 symlink 共享在"从本地路径添加 marketplace"时的实际行为**：是原地加载（symlink 自然可用）还是被跳过。
17. **插件 `start` 脚本里的 `bun install` 在国内网络下的表现**，以及是否需要允许用户覆盖 registry。
18. **WebSocket 下线声明被删除的官方说明。** 没有找到公告；如果需要更强的保证，可以在官方开发者社区频道或 [tencent-connect/openclaw-qqbot 的 issue](https://github.com/tencent-connect/openclaw-qqbot/issues) 里求证。

---

## 来源列表

访问日期均为 2026-11-10。QQ 文档条目后的日期是页面上的"上次更新"。

### QQ 开放平台官方文档（现行）

- [QQ Bot介绍与接入指南](https://bot.q.qq.com/wiki/) — 2026-10-21
- [常见问题](https://bot.q.qq.com/wiki/bot_FAQ/) — 2026-11-03
- [Agent 接入（含官方 OpenClaw 插件更新日志）](https://bot.q.qq.com/wiki/agent-qqbot/) — 2026-11-03
- [运营规范](https://bot.q.qq.com/wiki/business/)
- [启动接入](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/getting-started.html) — 2026-07-21
- [获取访问凭证](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/access-token.html) — 2026-09-16
- [API 调用指南（唯一身份机制、错误码）](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/api-call-guide.html) — 2026-09-17
- [通用数据结构（Payload、OpCode、Intents）](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/payload.html) — 2026-07-21
- [Webhook 方式](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/webhook.html) — 2026-09-11
- [WebSocket 方式](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/websocket.html) — 2026-07-30
- [事件订阅与通知（旧版聚合页，仍在线）](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html) — 2026-09-11
- [安全和授权（Ed25519 签名）](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/sign.html) — 2024-09-12
- [获取通用 WSS 接入点](https://bot.q.qq.com/wiki/develop/api-v2/openapi/wss/url_get.html) — 2026-07-30
- [WebSocket 错误码](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/error-trace/websocket.html) — 2026-07-21
- [消息收发概述](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html) — 2026-07-21
- [发送单聊消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html) — 2026-10-28
- [流式发送单聊消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_stream_messages.post.html)
- [撤回单聊消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages_message_id.delete.html) — 2026-07-22
- [发送群聊消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html)
- [单聊消息事件](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/c2c_message_create.html) — 2026-09-16
- [群@机器人消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_at_message_create.html) — 2026-09-16
- [群消息（全量模式）](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html) — 2026-10-21
- [用户添加好友事件](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/friend_add.html)
- [互动事件 INTERACTION_CREATE](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/interaction_create.html)
- [互动事件响应](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/interactions_interaction_id.put.html)
- [消息交互概述](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/overview.html) — 2026-07-21
- [消息按钮](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/msg-btn.html)
- [表情表态](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/emoji.html)
- [消息类型](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/type/overview.html) — 2026-07-23
- [富媒体消息概述](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/rich-media.html) — 2026-07-21
- [单聊富媒体上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_files.post.html)
- [单聊富媒体预上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_id_upload_prepare.post.html)
- [频道消息事件](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/channel/message/event.html)
- [变更记录](https://bot.q.qq.com/wiki/develop/api-v2/changelog.html) — 2026-10-28

### QQ 官方文档的历史存档（Internet Archive）

- 事件订阅与通知：[2024-11-07](http://web.archive.org/web/20241107040328/https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html)、[2025-02-19](http://web.archive.org/web/20250219060352/https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html)、[2025-07-11](http://web.archive.org/web/20250711025622/https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html)、[2026-01-03](http://web.archive.org/web/20260103052116/https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html)、[2026-03-26](http://web.archive.org/web/20260326232923/https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html)
- [发送消息（旧版，上次更新 2025-12-09，存档 2025-12-27）](http://web.archive.org/web/20251227020714/https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/send.html)
- [唯一身份机制（旧版，上次更新 2023-11-22，存档 2026-06-16）](http://web.archive.org/web/20260616053903/https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/unique-id.html)

### QQ 官方 GitHub 组织与 npm

- [tencent-connect/qqbot-nodejs](https://github.com/tencent-connect/qqbot-nodejs)（README、USAGE.md、`src/protocol/gateway/constants.ts`、`src/protocol/api/token.ts`、`src/protocol/utils/reply-limiter.ts`、`src/protocol/utils/text-chunk.ts`、`src/protocol/transport/webhook.ts`）
- [tencent-connect/openclaw-qqbot](https://github.com/tencent-connect/openclaw-qqbot)（README）
- [tencent-connect/dsh-qqbot](https://github.com/tencent-connect/dsh-qqbot)（README）
- [tencent-connect/bot-node-sdk](https://github.com/tencent-connect/bot-node-sdk)、[botgo](https://github.com/tencent-connect/botgo)、[botpy](https://github.com/tencent-connect/botpy)（仓库元数据）
- npm 元数据：[`@tencent-connect/qqbot-nodejs`](https://www.npmjs.com/package/@tencent-connect/qqbot-nodejs)、[`@tencent-connect/qqbot-connector`](https://www.npmjs.com/package/@tencent-connect/qqbot-connector)、[`@tencent-connect/openclaw-qqbot`](https://www.npmjs.com/package/@tencent-connect/openclaw-qqbot)、[`qq-guild-bot`](https://www.npmjs.com/package/qq-guild-bot)

### Claude Code 官方文档

- [Channels reference](https://code.claude.com/docs/en/channels-reference)
- [Push events into a running session with channels](https://code.claude.com/docs/en/channels)
- [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)
- [Plugin loading reference](https://code.claude.com/docs/en/plugins/loading.md)
- [Host and maintain a marketplace](https://code.claude.com/docs/en/plugins/host-marketplace.md)
- [MCP](https://code.claude.com/docs/en/mcp.md)

### 本机官方插件源码

目录 `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/`

- `discord/server.ts`、`discord/.mcp.json`、`discord/package.json`、`discord/bun.lock`、`discord/.npmrc`、`discord/.claude-plugin/plugin.json`
- `discord/skills/access/SKILL.md`、`discord/skills/configure/SKILL.md`、`discord/ACCESS.md`、`discord/README.md`
- `telegram/package.json`、`telegram/.mcp.json`、`telegram/server.ts`（仅用于对照 `start` 脚本和权限转发实现）
