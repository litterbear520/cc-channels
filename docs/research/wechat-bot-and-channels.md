# 个人微信接入 Claude Code Channel 可行性调研

查阅日期：**2026-11-13（Asia/Taipei）**。本次仅阅读公开文档、公开源码和本机指定材料；没有登录、扫码、调用需要凭据的接口、安装 npm 包或执行包脚本。npm tarball 仅在内存中解包，并校验 registry 给出的 SHA-512 integrity。

分工与核对：本文由 Orca 里的 codex 会话（GPT-6-Astra）按 `.scratch/wechat-channel/research/brief-for-astra.md` 调研并撰写，微信官方文档、Claude Code channel 文档和官方 discord / telegram 插件源码都由它阅读。维护方会话在 2026-11-13 独立抽查了以下几项，均与正文一致：npm 包 `@tencent-weixin/openclaw-weixin` 的 dist-tags（latest 2.4.10、beta 3.0.0-beta-0）、依赖、peer 依赖、engines 和 2.4.10 的 integrity；GitHub 仓库 `Tencent/openclaw-weixin` 存在、未归档、最近推送 2026-11-09；LICENSE 文本为 MIT；固定 commit 下有 `docs/protocol_zh_CN.md`；issue #202、#286、#290 存在且标题与正文描述相符。其余内容未逐条复核。**没有任何实机验证。**

## 结论摘要

**判断：有条件可行。推荐腾讯官方微信 ClawBot / iLink 通道，由本机 Bun + TypeScript MCP server 直接实现公开 HTTP 协议。** 微信用户在 ClawBot 会话里给自己的 Claude Code 发消息；本机使用出站 HTTPS 长轮询收消息并调用发送接口，无需公网回调、域名或固定出口 IP。这里的可行性指技术方案具备实现依据，不代表第三方客户端已获得一份无条件的服务使用授权，也不代表维护者真实账号已通过风险验证。【文档明确】【源码明确】【推断】[WX-README] [WX-Protocol] [NPM-Stable]

最重要的限制：

1. **这是专门的 ClawBot 会话，不是接管个人微信全部好友和群聊。** 官方插件声明仅 `direct`；不能据类型里有 `group_id` 就承诺群聊、读取原有聊天记录或替本人给任意好友发消息。【源码明确】`@tencent-weixin/openclaw-weixin@2.4.10`，`src/channel.ts`、`src/api/types.ts`。[NPM-Stable]
2. **MIT 允许复用代码；微信后端的第三方客户端服务授权仍需核验。** 官方协议已明确面向兼容实现，甚至给出其他宿主的版本标识规则；腾讯也公开支持 CodeBuddy 接入。但未找到可从官方公开 URL 核验、完整涵盖本项目独立客户端的 ClawBot 服务条款。不能承诺“官方包，所以绝不封号”。【文档明确】【未验证】[WX-Protocol] [WX-CodeBuddy] [WX-License] [WX-Terms-Question]
3. **长任务回复和主动通知不能保证。** 回复需要保存并回传 `context_token`；公开协议没有保证 TTL、次数或 QPS。社区同时报告“24 小时／10 条”和“约 1.5–2 分钟失效”，不能选其中一个当官方常量，更不能套用公众号 48 小时规则。【源码明确】【未验证】`2.4.10`，`src/messaging/inbound.ts`、`send.ts`；[WX-Window-202] [WX-Window-286]
4. **产品开放范围和绑定流程会变化。** npm 稳定版为 `2.4.10`，测试版为 `3.0.0-beta-0`；后者增加绑定对象选择、他人绑定实名授权等流程，并扩展 PIN 处理。已找到 Android 支持的官方记录，不能沿用早期“仅 iOS”的说法；所有地区、海外 WeChat、新号是否都开放，仍无官方覆盖表可确认。【文档明确】【源码明确】【未验证】[NPM-Metadata] [WX-Beta] [WX-ClawPro]
5. **官方 npm 包是 OpenClaw 插件，不是独立的 Bun SDK。** 存在 OpenClaw SDK 运行时依赖、可选 `node:sqlite` 引用缓存和语音 WASM；beta 还引入 `undici`。建议实现小范围协议适配层，先完成本人私聊文本、门禁和可靠退出，再验证媒体与权限中继。【源码明确】【推断】`2.4.10` / `3.0.0-beta-0`，`package.json`、`index.ts`、`src/messaging/quote-store.ts`。[NPM-Stable] [NPM-Beta]

证据标记：**【文档明确】**是官方文档直接陈述；**【源码明确】**是指定版本源码或包元数据直接体现；**【推断】**是基于前述证据的设计判断；**【未验证】**是公开资料不足、社区报告或需要实机检验。官方仓库中的普通用户 issue 仍属于社区证据，不能升级为官方服务承诺。文末给出全部来源；引用 npm 源码时，以包版本与包内路径定位。

## 1. 可行性结论

### 1.1 已核实的官方身份与实际形态

官方身份不只依赖 npm scope：GitHub 的 `Tencent` 组织经过域名验证，其 `Tencent/openclaw-weixin` 仓库 README 直接指向 `@tencent-weixin/openclaw-weixin`；包内许可证署名 Tencent；腾讯云产品文档还给出微信 ClawBot 接入 CodeBuddy 的步骤。几条证据互相对应，足以确认这不是假冒官方的个人协议包。【文档明确】【源码明确】[WX-Org] [WX-README] [WX-CodeBuddy] [WX-License]

官方协议公开了 iLink 消息、登录和媒体接口，并明确提醒：“客户端类型和行为不能代表完整的服务端契约。”它面向实现或对接兼容后端的开发者，包含非 OpenClaw 宿主的 `channel_version` / `bot_agent` 指引。因而“公开官方协议可供技术实现”有直接依据；“任意第三方可永久无条件使用服务”没有同等依据。【文档明确】[WX-Protocol]

目标链路为：**本人手机微信 → 微信 ClawBot / 腾讯 iLink → 本机 channel MCP server → 当前 Claude Code 会话 → 本机 channel → 腾讯 iLink / CDN → 本人微信**。不必运行一个 OpenClaw agent 再间接驱动 Claude Code，也不必购买协议中转服务。【推断】依据 iLink 的 HTTP 协议和 Claude channel 的 stdio MCP 契约。[WX-Protocol] [CC-Reference]

### 1.2 硬约束逐项判断

| 硬约束 | 判断与条件 |
| --- | --- |
| 无公网 IP、域名、固定出口 IP | **符合已有客户端模型。** 登录、长轮询、发送、媒体均由本机主动发起 HTTPS，公开登录流程不要求配置 IP 白名单。【文档明确】【源码明确】这不是“任何共享出口永不受风控”的保证；多租户／出口规则未公开确认。【未验证】[WX-Protocol] [WX-IP-Question] |
| 只走腾讯官方开放途径 | **符合。** 使用腾讯公开仓库及其 iLink 接口；不使用网页版／iPad／Mac 私有协议、hook 或第三方协议服务。【文档明确】【推断】[WX-README] [WX-Protocol] |
| Bun + TypeScript，依赖来自 npm | **技术上可满足。** 协议核心是 HTTPS JSON、文件、加密及 MCP；无需特殊客户端注入。官方整包在 Bun 下的运行结果未验证，不能把 Node 声明当 Bun 测试结论。【源码明确】【推断】【未验证】见第 4 节。 |
| 个人，无企业资质、无认证公众号 | **官方登录不要求企业 AppID/Secret 或公众号。** 用户需有能开通 ClawBot 的微信；账号／地区资格待核。绑定他人 Bot 的新流程还涉及操作者微信支付实名。【文档明确】【未验证】[WX-CodeBuddy] [WX-Protocol] |
| 真实账号不能冒封号风险 | **当前不能给出零风险保证。** 本调研不授权真实账号实验。应先取得官方条款可核验版本或官方针对独立客户端的明确答复，再由维护者决定后续验证账号与范围。【未验证】【推断】[WX-Terms-Question] |

**采用建议：将 iLink 作为唯一首选候选，暂不据此宣布生产可用。** 第 8 节 P0 项若失败，应缩小为短回合个人问答，或继续搁置微信；不要改用非官方协议来绕过问题。公众号／测试号可作有公网环境时的备选，微信客服可作已有组织和可信出口时的备选，都不满足当前完整条件。【推断】

### 1.3 当前版本、正式与灰度的边界

| 对象 | 2026-11-13 核实状态 |
| --- | --- |
| npm `latest` | `2.4.10`，2026-10-11 01:02:07 UTC 发布。【源码明确】[NPM-Metadata] |
| npm `beta` | `3.0.0-beta-0`，2026-11-09 12:28:05 UTC 发布；官方明确不替换 `latest`。【源码明确】【文档明确】[NPM-Metadata] [WX-Beta] |
| npm `legacy` | `1.0.3`，2026-03-23 发布，另有宿主兼容标签。不是本次实现依据。【源码明确】[NPM-Metadata] |
| 官方仓库快照 | `0ad1ae91347a938f52f1e4e2abd6dcda51e05f9e`，2026-11-09；本报告的官方协议／README 链接固定此 commit。【源码明确】[WX-Commit] |
| ClawBot 产品 | 腾讯产品文档已有实际接入步骤，ClawPro 发布记录记载 2026-03-22 上线、03-23 Android 支持；没有查到覆盖全部个人微信与海外 WeChat 的 GA 承诺。【文档明确】【未验证】[WX-ClawPro] [WX-CodeBuddy] |

“npm 有稳定版”“新绑定流程有 beta”“微信产品是否对某账号全量开放”是三个不同问题，不能互相替代。【推断】

## 2. 途径对比

表中“采用”均指满足条件后的候选选择。公网回调与固定出口分开判断；个人能够注册某个产品，不等于拥有全部消息 API 权限。表内“官方=是”及对应文档直接列出的产品/API机制为【文档明确】，依据在各行列末；“未核验／未验证／未确认／本次未找到”归为【未验证】，采用／备选／排除及适配判断归为【推断】，不是官方否定所有其他可能途径。源码和其他推断在单元格另行标明。

| 途径 | 官方 | 公网回调／固定出口 | 企业主体或认证 | 个人能否开通 | 微信里看到的形态 | 私聊文本收发 | 账号／条款风险 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ClawBot / iLink 官方插件协议 | 是【文档明确】 | 无回调；现行客户端不配置固定出口【源码明确】 | 未要求企业或公众号；他人绑定新流程有实名【文档明确】 | 有个人扫码路径；具体地区／账号资格未验证 | 专门的 ClawBot 联系人／会话 | 有 `getupdates` / `sendmessage`；回复窗口未知 | 官方自动化用途明确；独立客户端完整服务授权未核验 | **采用，附 P0 条件** [WX-README] [WX-Protocol] |
| 公众号（现行文档称原订阅号），个人／未认证账号 | 是 | 开发者接收消息需公开接收端；该类账号当前出口白名单要求未逐项核验 | 官方定位包含个人；认证与高级接口权限须确认 | 具体账号能否取得客服 API 权限未验证 | 公众号会话 | 消息接收／被动回复有官方机制；个人当前客服主动接口资格未验证 | 不接管个人号，但必须遵守公众平台接口权限 | **备选**，不满足本机接收条件 [MP-Subscription] [MP-Subscription-KF] |
| 服务号 | 是 | 公网回调；API IP 白名单【文档明确】 | 2026 年个人注册／认证完整规则未核验，不能断言一律只限企业 | 当前个人能否新开通未验证 | 服务号会话 | 被动回复及客服消息；当前客服规则见下文 | 自动回复在平台机制内；不能泛化为任意主动私信 | **备选**，因网络条件不采用 [MP-Migration] [MP-Service] [MP-KF] |
| 公众平台接口测试号 | 是【文档明确】 | 测试公众平台消息接口仍按URL/Token回调模型准备【推断】 | 公开入口称无需公众账号；不等于生产账号 | 可申请体验；本次未登录检查实际接口列表 | 测试公众号【推断】 | 用于接口测试；当前具体权限／配额须后台确认 | 测试用途；未核实长期持续使用保证，非个人号自动化 | **备选，仅验证** [MP-Test] [MP-Receive] |
| 微信客服，企业微信接管／API 模式 | 是 | 通常通过回调通知再 `sync_msg`；token 可省但严格限频；自建应用需可信 IP | 企业客服与自建应用授权；未验证主体可能发送失败 | 未证实纯个人新账号能完整开通 | 微信客服会话 | 官方支持收发；48h / 5条规则 | 客服业务自动化有官方 API；不能借此自动化普通好友聊天 | **备选，需主体与网络条件** [KF-Intro] [KF-Sync] [KF-Send] [WECOM-IP] |
| 微信客服独立管理平台 | 是 | 本次官方 API 页面只返回前端壳，独立平台网络条件未核验 | 官方允许独立使用，不应把企微接管条件全部套用 | 当前独立平台个人准入未验证 | 微信客服会话 | 产品有客服能力；独立版开发条件未核验 | 不能因可独立使用就推断任意个人本机可用 | **备选但证据不足** [KF-Intro] [KF-Independent] |
| 小程序客服消息 | 是 | 推送至 URL、云函数或云托管服务；不同调用模式出口规则未核验 | 个人类目／认证／备案与客服 API 权限完整要求未核验 | 不把注册小程序等同于取得完整客服权限 | 小程序内入口打开的客服会话 | 官方客服文本／图片等，48h / 5条 | 限客服触发场景，不是普通微信好友 Bot | **备选**，不满足本机无回调目标 [MINI-KF] [MINI-Send] |
| 微信对话开放平台 / 智能对话 | 是 | 官方介绍含公众号、小程序、H5、开放 API；没找到个人号聊天的本机长连接接口 | 当前介绍面向个人、企业和开发者【文档明确】 | 可构建机器人，不等于获个人微信消息接入权 | 对接公众号、小程序等载体 | 智能客服／问答能力；未找到普通个人号收发契约 | 不能把对话引擎当个人微信 transport | **排除为直接消息入口** [DIALOG] |
| 微信开放平台网站／移动应用登录、分享等 | 是【文档明确】 | 根据各产品配置；没有找到本场景收消息接口 | 开发者／应用审核条件因产品而异 | 部分能力可申请，不等于获得聊天权限 | 登录、分享或唤起微信 | 本次所查文档未找到个人私聊收件流与任意回复接口【未验证】 | OAuth 身份授权不能替代消息自动化授权【推断】 | **排除** [OPEN-WX] |
| 企微成员与外部联系人互通 | 是 | 客户联系变更事件回调；新自建应用有可信 IP | 客户联系功能与相应应用授权 | 不是只有一个个人微信号即可接入 | 企业成员联系人／微信客户会话 | 产品能人工聊天；未找到客户联系 API 实时读写所有聊天的通用能力 | 不能把客户事件、群发、欢迎语拼成聊天机器人承诺 | **排除当前方案** [WECOM-External] [WECOM-External-Events] |
| 企微智能机器人长连接 | 是【文档明确】 | 官方 WebSocket 出站，不需公网回调 | 企业微信内创建并授权机器人 | 个人新团队能否取得入口未实测；即使能开通也不解决个人微信入口 | 企业微信内机器人会话 | 可在其支持的企微会话收发；不等于微信外部联系人入口 | 不能假定企微机器人可与外部个人微信用户私聊【推断】 | **排除为微信入口** [WECOM-Bot] [WECOM-Bot-Help] |
| 腾讯 CodeBuddy 的 ClawBot 接入 | 是 | 产品通过官方通道接入；产品自身部署另论 | 依产品账户要求 | 已有个人扫码使用说明 | 同类 ClawBot 会话 | 可与相应腾讯 agent 对话 | 证明存在非 OpenClaw 产品接入，但不自动授权本项目；运行的是另一 agent | **不作为 Claude channel 实现** [WX-CodeBuddy] |
| 公众号平台 AI 回复等托管能力 | 是，部分灰度 | 依公众号平台配置 | 公众号与能力资格 | 未确认个人当前灰度资格 | 公众号会话 | 平台 AI 回复，不是直接把当前 Claude Code 会话接入 | 平台托管能力与自托管 transport 不同 | **排除当前方案** [MP-Passive] |

### 2.1 公众号／测试号的细节与文档迁移

- **接收与被动回复：** 开发者配置服务器 URL 和 Token，微信将用户消息 POST 到服务器，接收字段包括 `FromUserName`、`ToUserName`、`CreateTime`、`MsgType`、`MsgId`；服务号被动回复须在 5 秒内返回，超时会重试，不能长时间等 Claude 完成。官方允许先回 `success`／空串，再用客服消息异步回复；若账号没有客服接口权限，长任务最终自动回信便没有因此得到保证。【文档明确】【推断】[MP-Receive] [MP-Passive]
- **当前客服窗口：** 新服务号官方客服介绍写明，用户发消息触发 **48 小时、5 条**；关注、指定菜单操作、扫码等触发条件存在 **1 分钟、3 条**规则。必须按触发事件区分，不写成所有动作一律 48 小时无限回复。早期文章里的“20 条”与当前页面不一致，本报告采用查阅日的新官方页面，同时保留旧资料过期的说明。【文档明确】[MP-KF]
- **主体：** 新公众号指南定位包含个人；本次没有可核验的当前完整“个人未认证账号 → 每个 API”后台权限表，也未获得现行服务号注册完整规则。检索出现第三方“个人服务号”说法，不能证实开放，也不能继续把旧的“个人绝对不能申请服务号”写成 2026 年官方结论。该不确定性不消除公网接收端要求；服务号另已明确要求 API IP 白名单，公众号当前白名单规则本次未逐项核验。【文档明确】【未验证】【推断】[MP-Subscription] [MP-Service] [MP-Migration]
- **测试号：** 公开入口称“无需公众帐号、快速申请接口测试号”，并宣传体验高级接口；这只能证明申请入口用途，不能当作永久、无限配额或生产使用承诺。本次未扫码核验其当前后台、有效期与关注人数上限。【文档明确】【未验证】[MP-Test]
- **迁移：** 旧 `doc/offiaccount/...` 文档路径有官方迁移／404 页面；已追到 `doc/service/...` 新文档。API IP 白名单与接收服务器 URL 都在新迁移说明里，故不能把公网隧道当成同时解决固定出口问题。【文档明确】【推断】[MP-Migration]

### 2.2 微信客服、小程序及企微互通的边界

- 微信客服 `sync_msg` 可读最近 3 天消息，单次最多 1000 条，通过 `cursor` / `next_cursor`、`has_more` 继续拉取；回调获得的 token 有 10 分钟有效期。**token 不是绝对必填**，官方说不填有严格频率限制。因此“完全没有回调就绝不能读消息”不准确；但这也不是一个已承诺的 Telegram 式无限长轮询替代方案。【文档明确】[KF-Sync]
- 微信客服 API 发送只适用于“新接入待处理”或“由智能助手接待”等规定状态，用户发消息后 **48 小时、最多 5 条**；用户继续发送可获得新的发送机会。2023-12-01 起新调用不再使用原系统应用 secret，存量企业暂不受影响；新自建应用的可信 IP 要求仍使其不满足本次无固定出口约束。异步发送失败类型还包括主体未验证、企业未有成员登录企微 App、安全限制；不能把主体验证直接等同于某一种付费认证。【文档明确】[KF-Send] [KF-Sync] [WECOM-IP]
- 小程序客服通过 `button open-type="contact"` 等入口打开，并把消息推给 URL、云函数或云托管；不能视作个人号通用聊天 transport。当前发送页写 48 小时最多 5 条，但同页混入“关注公众号／自定义菜单”等公众号措辞，不能把所有触发动作直接认定也适用于小程序。【文档明确】【未验证】【推断】[MINI-KF] [MINI-Send]
- 企业微信“成员能与微信客户聊天”是产品互通；客户联系 API 侧的添加／删除等事件不是普通聊天的逐条消息流。会话内容存档应另行评估，不能据其名称推导可自由代成员回复。企微智能机器人只支持内部会话，官方明确内部群可添加，外部群、互联群和上下游群不支持；昨天的长连接研究不能直接转换为个人微信入口。【文档明确】【推断】[WECOM-External] [WECOM-External-Events] [WECOM-Bot-Help] [WECOM-Bot]

公众号、微信客服、小程序公开了开发者自动收发消息的产品接口，这能证明对应产品的自动化能力；本次没有逐一核验把客服会话长期用于个人Claude终端控制的专项用途许可，也没有得到普通个人号任意聊天自动化的授权。因此这些路线同样不能仅凭“官方API”就宣称没有账号或条款风险。【文档明确】【未验证】【推断】[MP-Passive] [KF-Send] [MINI-Send]

## 3. 推荐途径的协议细节

本节以 **npm `2.4.10` 的实际实现**为稳定基线，补充 **`3.0.0-beta-0`** 和固定 commit 的官方协议说明。描述的是可据以设计 spike 的协议，不是已执行的账号操作；所有示例均为占位符。

### 3.1 开通、绑定与凭据

1. 用户手机微信需要可进入 ClawBot 接入流程。腾讯 CodeBuddy 文档给出微信 **8.0.70 或以上**条件；不需要公众号 AppID/Secret。此版本要求来自该产品的接入说明，不扩大成全部环境唯一最低版本保证。【文档明确】[WX-CodeBuddy]
2. 本地配置流程请求 `POST https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3`。本人绑定发送 `local_token_list`，可为空数组，已有绑定时客户端最多提供最近 10 个 bot token；展示返回的 `qrcode_img_content`，轮询使用另一个字段 `qrcode`。【源码明确】`2.4.10`，`src/auth/login-qr.ts`。[NPM-Stable]
3. `GET /ilink/bot/get_qrcode_status?qrcode=<编码后的值>`，单次客户端等待 35 秒。状态有 `wait`、`scaned`（拼写按接口）、`confirmed`、`expired`、`scaned_but_redirect`、`need_verifycode`、`verify_code_blocked`、`binded_redirect`。重定向时按返回 `redirect_host` 转到 HTTPS 主机，不能永远固定初始地址。【源码明确】同上。
4. 若手机要求 PIN，读取用户输入，在**下一次**状态轮询加入 `verify_code`；成功后清掉 PIN。`2.4.10` 已有基本 `need_verifycode` 分支，beta 扩展到包含 `need_verifycode` 的状态（如 `confirmed_but_need_verifycode`），并增加请求验证开关。不能写成“PIN 全部是 beta 才首次出现”。【源码明确】两版 `src/auth/login-qr.ts`。[NPM-Stable] [NPM-Beta]
5. 成功响应提供 `bot_token`、`ilink_bot_id`、`baseurl`、`ilink_user_id`。前两者是 Bot 凭据／身份，`ilink_user_id` 是扫码用户身份，可作为本地 owner allowlist 的初始候选；不是微信显示名、手机号或可读微信号。稳定版持久化 token、baseUrl、userId、savedAt，并对凭据文件尝试设置 `0600`。【源码明确】`src/auth/login-qr.ts`、`src/auth/accounts.ts`。[NPM-Stable]
6. `binded_redirect` 表示已绑定，服务端不会重新发凭据；实现需复用已有本地凭据或明确告知无法恢复，不能把空 token 当成功新登录。【源码明确】`2.4.10`，`src/auth/login-qr.ts`。[NPM-Stable]

稳定版登录会话的本地新鲜度检查为5分钟，等待扫码默认总时限480秒，换码计数最多3；这些是客户端实现参数，不应称为服务端二维码或Bot token的官方有效期。beta 可通过 `verifyPin:true` 或单次环境开关请求PIN，将 `bot_spam_business_data` 设置为UTF-8 JSON `{"verify_pin":1}` 的标准base64字符串；未请求时不带此字段。开关关闭也不能阻止服务端要求验证，状态处理必须完整。【源码明确】【文档明确】两版 `src/auth/login-qr.ts`；[WX-Protocol] [WX-Beta]

**beta 的实名分支：** `promptBindOwner` 当前默认 `false`。开启后，选择本人仍直接绑定；选择他人则先访问 `https://weixin110.qq.com/security/acct/botrealnameverifycgi` 的 `get_auth_url` / `query_auth_result`，操作者用已开通微信支付实名的本人微信授权，再把 `bot_spam_ticket` 交给 Bot 绑定请求，最终由实际用户扫描 Bot 二维码。实名 ticket 的 `expire_time` 是 Unix 秒，等待上限取 480 秒与过期时间较早者。PIN 和实名是独立流程，PIN 不发给实名 CGI。官方说未来计划默认开启选择入口，未给切换日期。【文档明确】【源码明确】[WX-Beta] [WX-Protocol]；`3.0.0-beta-0`，`src/auth/bot-spam-ticket.ts`、`login-qr.ts`。

**凭据有效期与续期：** 登录返回结构没有 `expires_in` 或 `refresh_token`；未发现刷新 bot token 的接口、固定重新扫码周期或长期有效承诺。`-14` 在源码中表示 stale / expired session，现有插件暂停该账号请求一小时，之后再尝试；这只是客户端退避，绝不是自动续期成功的证明。需要重新扫码时应在本地配置流程处理，不做无限扫码／重试。【源码明确】【未验证】【推断】`2.4.10`，`src/api/session-guard.ts`、`src/monitor/monitor.ts`。[NPM-Stable]

**不能照搬到 MCP stdio 的部分：** 官方登录函数直接读 stdin、写 stdout 展示 QR 和 PIN 提示；channel 的 stdin/stdout 已用于 MCP JSON-RPC。应把登录做成独立配置命令或有明确输入通路的设置步骤，运行时日志走 stderr，不能向 MCP stdout 混入二维码和提示文本。【源码明确】【推断】`src/auth/login-qr.ts` 与 Claude stdio 契约。[NPM-Stable] [CC-Reference]

### 3.2 地址、鉴权与请求公共字段

| 项目 | 已知实现 |
| --- | --- |
| 初始 API | `https://ilinkai.weixin.qq.com`；登录成功后使用 `baseurl`。【源码明确】 |
| 默认 CDN | `https://novac2c.cdn.weixin.qq.com/c2c`；有完整媒体 URL 时优先使用返回 URL。【源码明确】 |
| 鉴权 | Bot POST：`AuthorizationType: ilink_bot_token`、`Authorization: Bearer <bot_token>`；JSON `Content-Type`。【源码明确】 |
| 其他请求头 | `X-WECHAT-UIN` 是随机 uint32 十进制文本再 base64，不是真实用户 UIN；`iLink-App-Id: bot`；`iLink-App-ClientVersion` 为版本编码 `0x00MMNNPP` 的十进制形式（主、次、修订各占8位）。【源码明确】 |
| 正文公共字段 | `base_info.channel_version`、`base_info.bot_agent`；后者是观测标识，不用于鉴权或路由。【文档明确】【源码明确】 |
| QR 请求例外 | 取码 POST 无 Bearer token、无 `base_info`；状态 GET 只用公共 app 头，不发送 Bot 鉴权和随机 UIN。【文档明确】【源码明确】 |
| 可选路由 | `SKRouteTag` / `_cradle_hostname` 是特定部署路由配置，普通用户不应复制测试路由值。【文档明确】 |

表据：`2.4.10` 的 `src/api/api.ts`、`src/auth/accounts.ts`、`src/auth/login-qr.ts`；[WX-Protocol] [NPM-Stable]。

官方协议要求其他宿主在 `channel_version` 前三段使用其兼容的 openclaw-weixin 协议版本，自身版本放后缀；`bot_agent` 可明确标识自己的应用。**不要冒充 OpenClaw，也不要凭空上报未来版本。** 支持版本区间由服务端控制，精确独立客户端标识与版本组合列入 spike。【文档明确】【推断】【未验证】[WX-Protocol]

### 3.3 收消息、游标、断线、重复投递

接口为 `POST /ilink/bot/getupdates`，首次正文的 `get_updates_buf` 为 `""`，以后原样回传上一有效响应中的同名游标；带 `base_info`。返回 `ret`、`errcode`、`errmsg`、`msgs`、`get_updates_buf`、`longpolling_timeout_ms`。`sync_buf` 只是废弃兼容类型，当前实现不会用它替代新游标。【源码明确】`2.4.10`，`src/api/api.ts`、`src/api/types.ts`、`src/storage/sync-buf.ts`。[NPM-Stable]

- 默认长轮询 35 秒，服务端给出正数 `longpolling_timeout_ms` 时用于下一次请求；超时不等于掉线错误，外部 abort 用于停止。普通 API 默认 15 秒，getconfig / typing 等轻量请求默认 10 秒，均是客户端设置，不是平台 SLA。【源码明确】`src/api/api.ts`、`src/monitor/monitor.ts`。
- 普通失败间隔 2 秒，连续 3 次后退避 30 秒；`ret` 或 `errcode` 为 `-14` 时走一小时暂停。该策略可作参考，channel 应加入有界退避和明确状态，不把不断重试写成“保证恢复”。【源码明确】【推断】同上。
- **稳定版可靠性缺口：** `2.4.10` monitor 先保存游标，再顺序 `await processOneMessage`；崩溃或单条处理异常时，可能已推进游标却尚未处理后续消息。未看到稳定 monitor 自己维护跨重启的已完成消息去重表。【源码明确】【推断】`src/monitor/monitor.ts`。
- **beta 改进：** `InboundJournal` 把原始消息和游标一起原子持久化，记录 `pending`、`processing`、`interrupted`；重启恢复尚未开始的任务，已开始任务标记中断而不自动重跑；保留最近 10,000 个完成 ID。其账号内键为发送者与 `message_id`，缺少时找 item 的 `msg_id`；连 ID 都没有只能生成本地随机键，不能可靠识别服务器重复投递。【源码明确】`3.0.0-beta-0`，`src/storage/inbound-journal.ts`、`src/monitor/monitor.ts`。[NPM-Beta]
- **建议 channel 的去重键：** `(bot account, from_user_id, message_id)`，无损保存 ID；处理前验证发送者与会话类型。`message_id` 是 wire 上的 uint64，官方源码把它以及 `msg_id`、`svr_id` 解析为字符串，避免 JavaScript 数字精度损失。不能先 `JSON.parse` 成 number，再用 `String` 挽回已丢失的精度。【源码明确】【推断】`2.4.10`，`src/api/api.ts::parseWeixinApiJson`、`src/api/types.ts`。[NPM-Stable]

本地去重／journal 不能承诺外部工具动作严格 exactly-once；MCP 通知与本地持久化、实际工具执行之间没有本次查到的跨系统事务。重启后应区分“未交付”“已交付但结果未知”，避免自动重跑有副作用任务。【推断】

### 3.4 同号多连接、多客户端与生命周期

官方支持一个 OpenClaw Gateway 配多个微信账号，并按账号、channel、peer 隔离会话。**这不等于同一个 bot token 可以被多个 poller 同时消费。** 未找到关于同 token 多连接是广播、竞争消费、后连踢前连，还是依游标独立读取的服务端保证。【文档明确】【未验证】[WX-README] [WX-Protocol]

稳定版绑定后会清除本机同 `userId` 的旧账号记录，以避免出站 context token 路由歧义；这只是本地清理，不证明微信服务器全局撤销了旧 token。`notifystart`、`notifystop` 也是生命周期通知，不是分布式锁协议。【源码明确】`2.4.10`，`src/auth/accounts.ts::clearStaleAccountsForUserId`、`src/channel.ts`。[NPM-Stable]

建议首版**每个 bot account 同时只允许一个本地进程**消费；用账号级锁／PID 所有权和清晰的冲突错误，实测前不默认抢占另一客户端。MCP stdin EOF、SIGTERM、SIGINT 时中止轮询、收尾状态、限时调用 `POST /ilink/bot/msg/notifystop` 并退出；启动调用 `/ilink/bot/msg/notifystart`。不能让收尾网络请求无限阻塞退出。【推断】依据官方生命周期和 Telegram 样板，第 5 节详述。

### 3.5 发送、主动消息、窗口和限制

`POST /ilink/bot/sendmessage` 的文本主体如下，仅为字段示意，不是经过实机验证的最小请求：【源码明确】`2.4.10`，`src/messaging/send.ts`、`src/api/api.ts`。[NPM-Stable]

```json
{
  "msg": {
    "from_user_id": "",
    "to_user_id": "<已授权发送者ID>",
    "client_id": "<本次发送的随机关联ID>",
    "message_type": 2,
    "message_state": 2,
    "context_token": "<当前会话令牌>",
    "item_list": [{"type": 1, "text_item": {"text": "回复内容"}}]
  },
  "base_info": {
    "channel_version": "<兼容的插件协议版本>",
    "bot_agent": "<本客户端Name/Version>"
  }
}
```

- **回复与主动发送用同一个接口。** 官方插件从入站消息保存 `(accountId, userId) → context_token`，出站查缓存，支持定时任务目标路由的客户端结构；没有 QQ 式 `msg_seq`、明确的“被动失败改另一主动接口”流程。【源码明确】`src/messaging/inbound.ts`、`src/channel.ts`、`src/messaging/send.ts`。
- **缺 context token 仍调用发送不证明可送达。** 稳定版 helper 只警告并继续请求；协议文档专门提醒这不是服务端接受保证。首版应在本地缺少有效会话上下文时返回清楚错误，不猜测或制造 token。【源码明确】【文档明确】【推断】[WX-Protocol]
- **有效期、条数和频率：未查到官方完整数值契约。** issue #202 用户称 24 小时、10 条；issue #286 用户称 73 秒成功、135 秒失败，且省略 token 也失败。两者都是社区报告，涉及不同时间／账号／环境；本报告不据此断言所有账号的现行阈值，也不声称 typing、先发“收到”或持续发消息能延长窗口。【未验证】[WX-Window-202] [WX-Window-286]
- **文本长度：** 官方插件 `outbound.textChunkLimit = 4000`，是宿主分块配置，不是已公布的服务端字符／字节上限；helper 本身不等于每一路发送均已自动分块。需测试中文、emoji、代码块与多段顺序，并把本地安全限额和服务端硬限额分开写。【源码明确】【未验证】`src/channel.ts`。
- **回执：** 返回可以有 `ret`、`errmsg`、`message_id`；官方 helper 对非零 `ret` 抛错，返回 ID 区分客户端 ID 与服务端 ID。`ret:0` 不能被本调研提升为“手机端已显示”，官方仓库已有用户报告接受成功但不可见。【源码明确】【未验证】`src/api/api.ts`、`src/messaging/send.ts`；[WX-Delivery-290]。
- **重试：** 请求超时或连接断开后，服务端可能已经接受。没有查到 `client_id` 幂等性的正式保证；不要换 ID 自动重发，返回“结果未知，可能已送达”。明确业务拒绝也不能未经核验就尝试所谓主动兜底。【未验证】【推断】

因此长任务完成通知、配对确认、权限请求都受同一发送通道约束。必须验证“用户发起任务 → 运算数分钟 → 权限请求 → 用户决定 → 最终答复”整条链，单测一次 echo 不足以证明这个 channel 满足日常使用。【推断】

### 3.6 消息格式与会话能力

| 能力 | 当前证据与建议 |
| --- | --- |
| 纯文本 | 入站 `text_item.text`；出站 type 1，已实现。【源码明确】`types.ts`、`send.ts`。 |
| Markdown | 不是一个独立 Markdown 消息类型；仍发文本。官方 `StreamingMarkdownFilter` 保留代码围栏、行内代码、表格、粗体等，过滤部分中文斜体、H5/H6 和 Markdown 图片语法。可参考有限子集，手机实际渲染需测，不能承诺全 Markdown。【源码明确】【未验证】`src/messaging/markdown-filter.ts`。 |
| 图片 | type 2；入站下载解密、出站上传后发送，已实现。【源码明确】`media-download.ts`、`send-media.ts`、`send.ts`。 |
| 文件 | type 4；含文件名和十进制字符串长度；已实现双向路径。【源码明确】同上。 |
| 语音 | type 3，`voice_item.text` 可带微信转写；无文本时可下载语音，尝试 `silk-wasm` 转 WAV。类型包含语音上传枚举，但当前通用出站只分图片／视频／文件，不能由枚举推断可发送原生语音气泡。【源码明确】`types.ts`、`media-download.ts`、`silk-transcode.ts`、`send-media.ts`。 |
| 视频 | type 5；双向媒体路径已实现，播放、时长等实际体验未验证。【源码明确】【未验证】`send.ts`、`media-download.ts`。 |
| 引用回复 | 入站有 `ref_msg.message_item`、`title`、`svr_id` 和部分引用定位信息；可借本地缓存恢复 ID-only 引用。没有发现等价于 Telegram `reply_to_message_id` 的已实现出站通用引用参数；不能只因存在 `ref_msg` 类型就承诺原生出站引用。【源码明确】【未验证】`types.ts`、`inbound.ts`、`partial-quote.ts`、`send.ts`。 |
| 正在输入 | `getconfig` 取得 `typing_ticket`；`sendtyping` 发 `ilink_user_id`、ticket、`status:1`，结束为 2。配置缓存是客户端 24h 内随机刷新策略，不是 ticket 保证有效期；typing 不证明刷新 context token。【源码明确】【未验证】`api.ts`、`config-cache.ts`。 |
| 工具进度 | 已有 item 11/12 的工具开始／结果结构和 `run_id`；属于进度展示，不是审批按钮。是否应暴露 Claude 工具名及实际渲染待设计和实测。【源码明确】【推断】`reply-progress-sender.ts`。 |
| 编辑／撤回 | 未找到公开客户端 API；`message_state`、`update_time_ms`、`delete_time_ms` 的存在不等于编辑／撤回方法。【源码明确】【未验证】`api.ts`、`types.ts`。首版不提供。 |
| 表情回应／按钮 | 未找到 reactions 或交互按钮发送及回调接口；普通 Unicode emoji 文本不等于表情回应 API。【未验证】同上。 |
| 历史消息 | 没有发现按消息 ID／时间查询历史的 API；游标续收、离线补收能力与本地 quote cache 不能称作读取微信全量历史。【源码明确】【未验证】`api.ts`、`quote-store.ts`。 |
| 群聊／任意好友 | `chatTypes:["direct"]`；首版排除群聊、朋友圈、通讯录和个人原有好友聊天访问。【源码明确】`channel.ts`。 |

表内源码均指 `@tencent-weixin/openclaw-weixin@2.4.10`，包内 `src/` 路径；[NPM-Stable]。

### 3.7 附件下载、加密与上传

**入站：** 从 `image_item` / `voice_item` / `file_item` / `video_item` 的 `media` 取引用。优先 `full_url`，否则拼 `https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=<URL编码参数>`。CDN 请求本身不添加 Bot Bearer token；URL 参数应当按敏感下载凭据处理。加密内容用 **AES-128-ECB + PKCS#7** 解密；图片优先 `image_item.aeskey`（hex），否则 `media.aes_key`。后者兼容 base64(raw 16 bytes) 和 base64(32 位 hex 文本)。不能把“密文经 CDN”描述成腾讯无法解密的端到端加密。【源码明确】【推断】`2.4.10`，`src/cdn/pic-decrypt.ts`、`aes-ecb.ts`、`cdn-url.ts`、`src/media/media-download.ts`。[NPM-Stable]

图片无两种 key 时源码可以按明文处理；语音／文件／视频缺 `media.aes_key` 则跳过。具体下载 URL 的有效期、服务器最大附件大小和离线保留时间没有查到官方承诺。【源码明确】【未验证】同上。

**大小／超时不能混淆：** 稳定版向媒体存储层传入 `100 * 1024 * 1024` 字节限制，但 CDN 函数先完整 `arrayBuffer()`；这不是下载时内存上限，也不是平台允许 100 MiB 的证明。引用缓存另有默认 25 MiB 单文件、256 MiB 每账号媒体总量、7 天媒体／30 天消息／10,000 条消息策略，均属本地缓存。beta 增加下载停滞超时默认 30 秒，总下载时限默认 0（不限），不表示取消大小约束。【源码明确】两版 `media-download.ts`、`pic-decrypt.ts`、`quote-store.ts`；[WX-Beta]。

建议：先通过发送者 gate，再保存有界附件描述；默认工具按需下载。下载时逐块统计大小、校验允许的 HTTPS CDN URL／重定向、超时中止、清理不完整文件并防路径穿越；超过本地限额必须报错。不能将收到的任意 URL 交给带凭据的通用请求器。【推断】由官方客户端顺序和 Claude 安全要求推得。

**出站完整流程：**【源码明确】`2.4.10`，`src/cdn/upload.ts`、`cdn-upload.ts`、`src/messaging/send.ts`。[NPM-Stable]

1. 在本地发送工具中先验证目标在 allowlist、文件路径和大小合法，再读明文文件，计算 MD5／长度，生成 16 字节 AES key 和 file key。
2. `POST /ilink/bot/getuploadurl`，字段包括 `filekey`、`media_type`（图片 1／视频 2／文件 3，语音枚举 4 但通用发送未实现）、`to_user_id`、`rawsize`、`rawfilemd5`、填充后的 `filesize`、`no_need_thumb:true`、hex `aeskey` 和 `base_info`。第一步的本地安全检查是本项目建议，后续 wire 字段是官方实现。
3. 取 `upload_full_url`；缺少时用 `/upload?encrypted_query_param=<upload_param>&filekey=<filekey>`。将 AES-ECB 密文以 `application/octet-stream` **POST** 到 CDN。
4. 当前客户端以 HTTP 200 且存在响应头 `x-encrypted-param` 判成功；4xx 立即失败，其他失败最多尝试 3 次。这是 CDN 传输策略，不能推导文本消息也可安全重发。
5. 把下载参数和 `base64(hex AES key文本)` 放进媒体引用，用 `sendmessage` 发送。图片 `mid_size`、视频 `video_size` 用密文长度；文件 `len` 用明文长度字符串。
6. 说明文本和媒体分别发送，每个请求各一个 item、独立 `client_id`。这会消耗多次发送机会；正文成功而媒体失败时要返回部分成功，不能整组无条件重试。

### 3.8 发送者身份、谁能联系 Bot

**门禁字段用 `from_user_id`，并绑定 bot account。** 登录的 `ilink_user_id` 可用作 owner 起点；入站 `to_user_id`／`session_id` 不是发件人身份。`X-WECHAT-UIN` 是客户端随机头，更不能用来做 allowlist。通过持有 Bot token 的 HTTPS 请求获得的字段，比消息正文、昵称可靠；但长期跨重新绑定稳定性、跨 Bot 的 ID 一致性及服务端反冒充保证未找到明确契约，应做重绑定测试。【源码明确】【推断】【未验证】`2.4.10`，`login-qr.ts`、`api.ts`、`process-message.ts`。[NPM-Stable]

官方稳定版优先读取 pairing 的 allowFrom 文件，没有时回退保存的扫码 userId；旧账号两者都没有时，普通消息会被允许而命令不授权。**本项目不能继承这个兼容性放行：缺 owner／allowlist 一律不转发给 Claude。** 本地配对审批应保留为单独信任步骤，或在配置流程让操作者明确确认扫码 owner。【源码明确】【推断】`src/messaging/authorization.ts`、`process-message.ts`。

官方公开能力是 direct，会话来源以绑定流程为中心；没有查到“任何人可搜索加 Bot”“仅好友可加”“可以转发给任意第三人后聊天”的完整规则。首版只承诺已绑定本人，不把协议里的 `to_user_id` 当成向任意微信号发信的许可。【未验证】【推断】[WX-README] [WX-Protocol]

## 4. 官方 SDK、依赖与 Bun 适配

### 4.1 包、维护状态与许可证

| 项目 | 核实结果 |
| --- | --- |
| 官方消息插件 | `@tencent-weixin/openclaw-weixin`；仓库 `Tencent/openclaw-weixin`；MIT，包内实际有 `LICENSE`。【文档明确】【源码明确】[WX-README] [WX-License] [NPM-Metadata] |
| 稳定版 | `2.4.10`，2026-10-11 发布；131 个打包文件。运行依赖 `qrcode-terminal:0.12.0`、`zod:^4.3.6`；peer `openclaw:>=2026.5.12`；Node `>=22.13.0`。【源码明确】[NPM-Stable] |
| beta | `3.0.0-beta-0`，2026-11-09 发布；160 个打包文件；增加 `undici:8.10.0`，其他主要运行／peer 声明相同。【源码明确】[NPM-Beta] |
| 安装器 | `@tencent-weixin/openclaw-weixin-cli`，latest `2.1.4`，2026-05-15 发布，metadata 标 MIT；用途是配置／安装 OpenClaw 插件，不是应加入 channel 的协议 SDK。【源码明确】【推断】[NPM-CLI] |
| 近期维护 | 官方 11 月仍发布绑定和消息恢复改进；处于活跃修改状态。但活跃维护不构成服务 SLA，beta 官方说明仍有真实故障联调与旧环境兼容缺口。【文档明确】【源码明确】[WX-Commit] [WX-Beta] |

本次校验的 registry integrity：

```text
2.4.10: sha512-qCN7rFtBK5BO/i5YGEJLdpC/8WQrm0dtPlQ0xNxku4RSyzGaRsiBoLVheU5hgpoOIBvfc5pUwKTktMbROLcIVg==
3.0.0-beta-0: sha512-l9bDidP+YVfpqdQ3HwH/su8cFadEYuIkFkPxK2k1lsIaL5r5QoZQSOOBrxUgWWk55fNr1k9u+/QMVtL9M2apkQ==
```

这是公开包的内容摘要，不是任何账号 token。源码定位请使用对应 npm tarball，不要把不断变化的 `main` 误称为稳定版源码。【源码明确】[NPM-Metadata]

### 4.2 宿主耦合与原生模块

- `index.ts` 使用 OpenClaw `plugin-entry`，channel、授权、路由、媒体存储、hooks、typing、配置写回等依赖多个 `openclaw/plugin-sdk/*`。直接 import 整包并不能得到一个独立 MCP channel；连部分底层 API 的配置／logger 导入链都连到宿主辅助函数。【源码明确】`2.4.10`，`index.ts`、`src/channel.ts`、`auth/accounts.ts`、`messaging/authorization.ts`、`util/logger.ts`。[NPM-Stable]
- 直接运行依赖中未见需要 `node-gyp` 编译的 addon；但不能把这句话扩大到整个 OpenClaw peer 依赖树。引用缓存动态使用 **Node 内建 `node:sqlite` / `DatabaseSync`**，失败会停用缓存，不阻断所有文本通信；它不是 npm 原生 addon，却仍是兼容性关注点。【源码明确】`src/messaging/quote-store.ts`。
- SILK 转码动态 import **`silk-wasm`**，源码存在降级为原始 SILK 的路径；该包在官方 manifest 中是 devDependency，不能假设实际生产安装一定能解析。可单独从 npm 选择并锁定，或首版只处理微信提供的语音转写与原始文件，不调用外部系统转码器。【源码明确】【推断】`package.json`、`src/media/silk-transcode.ts`。
- beta 的 `undici@8.10.0` metadata 要求 Node **>=22.19.0**，高于插件自身写的 >=22.13.0；官方 beta 发布说明也承认最低版本声明尚未统一。不能据插件 engines 断言旧 Node 或 Bun 全兼容。【源码明确】【文档明确】[NPM-Undici] [WX-Beta]

### 4.3 能否只取协议部分自己实现

**可以作为工程方案，需保留服务条款条件。** MIT 允许在满足版权／许可声明要求的情况下使用、修改、分发源码；官方协议本身也为兼容实现提供指导。但这些证据只覆盖代码复用与技术意图，不补出尚未核验的后端服务使用条款。【文档明确】【推断】【未验证】[WX-License] [WX-Protocol]

建议首版实现自己的 `WeixinTransport`：登录／凭据、长轮询、消息映射、发送、媒体五个边界，和 MCP、access store、permission relay 分开；协议字段依据官方资料独立实现，不拷贝第三方 channel 仓库代码。核心可以使用 Bun 的 `fetch`、AbortController、文件 API、`node:crypto`，npm 依赖保持 MCP SDK、schema 和必要 QR／无损 JSON 工具的最小集合；这是一项设计建议，不是本次已经创建的接口或代码。【推断】

Bun 官方当前兼容表列出 `node:sqlite` 支持并说明 macOS 系统 SQLite 的差异；`node:crypto` 也有兼容性范围。**本次没有执行任何 Bun 协议／加密测试，也未装包，故 Bun 实机兼容结论仍为未验证。** 应在后续 spike 测 AES-128-ECB、PKCS#7、无损 uint64、取消长轮询、TLS、流式大小限制及可选 WASM，不能用“TypeScript 能运行”替代这些检查。【文档明确】【未验证】[BUN-Compat]

## 5. 对照 Claude Code Channel 要求和官方插件

### 5.1 Claude Code 当前要求

线上文档仍称 channels 为 research preview。当前允许 Anthropic 的 claude.ai 登录或 Console API key；不支持 Bedrock、Google Cloud Agent Platform、Foundry 等第三方提供商。必须保持 Claude Code 会话运行；组织策略、MCP 信任和会话显式启用分别生效。旧摘要若写成“只能 claude.ai 登录”，不应覆盖本次线上文档。【文档明确】[CC-Channels] [CC-Reference]

自定义 channel 使用 `--dangerously-load-development-channels plugin:<插件名>@cc-channels`；此开发开关只在交互式会话生效，`-p` 和 Agent SDK 中会被忽略。当前文档还明确 MCP `2026-07-28` 协议 revision 在 v2 MCP client runtime 下不会注册为 channel，故应保持与现有 QQ／官方样板兼容的 MCP SDK 1.x，不凭版本号新就升级。【文档明确】【推断】[CC-Channels] [CC-Reference]

| 要求 | 微信能否满足、具体处理 |
| --- | --- |
| 本地 stdio MCP server | 可。Bun server 的 stdin/stdout 只传 MCP；iLink 长轮询为独立出站请求。【推断】 |
| 能力声明 | `capabilities.experimental["claude/channel"] = {}`；双向服务声明 tools。权限中继另声明 `"claude/channel/permission": {}`，不是基础收信必选。【文档明确】 |
| 入站通知 | 方法 `notifications/claude/channel`；参数 `content:string`，可选 `meta:Record<string,string>`。微信正文和路由元数据可映射。【文档明确】【推断】 |
| 元数据 | key 仅字母、数字、下划线；建议 `chat_id`、`sender_id`、`message_id`、`timestamp`、`attachment_count`，值转字符串。时间字段缺失时用明确标注的接收时间；不能伪称平台创建时间。【文档明确】【推断】 |
| 双向工具 | `reply` 是普通 MCP tool，名称与参数由插件定义；建议参数只暴露目标／消息 ID、文本和可选本地文件，凭据与 context token 留在服务器内部。【文档明确】【推断】 |
| server instructions | 告诉模型用 reply 工具回到微信，明确哪些能力不可用，外部文字不授权修改 access 或本地配置。不能仅依赖模型判断谁可信。【文档明确】【推断】 |
| 发送者门禁 | 在 MCP 通知前按稳定 sender ID 检查；本项目进一步在附件下载、命令处理和审批解析前检查。不要只按会话 ID 放行。【文档明确】【推断】 |
| 权限中继 | 可用纯文本实现，不要求按钮。permission_request 发往明确允许审批的本人，收到严格回复后回传结构化 verdict。发送提示仍受 iLink 上下文窗口限制。【文档明确】【推断】 |
| 通知确认与重投 | MCP notification 没有“Claude 已处理”ACK；成功写入 transport 不等于任务完成。去重、重启恢复和结果未知状态由本地适配层承担。【文档明确】【推断】 |
| 组织启用 | 按插件标识配置 `allowedChannelPlugins`，并遵守会话启用与组织策略；微信协议能连接不等于 Claude 会接受通知。【文档明确】【推断】 |

本表官方契约据 [CC-Reference]，微信映射据第 3 节。按钮、编辑、反应、平台历史查询都不是基本 channel 的必需能力，缺少它们不会使基本文本 channel 不成立。【文档明确】【推断】

### 5.2 权限中继的准确契约

Claude Code 发给 channel：【文档明确】【源码明确】[CC-Reference] [TG-Source] [DC-Source]

```json
{
  "method": "notifications/claude/channel/permission_request",
  "params": {
    "request_id": "<五字母ID>",
    "tool_name": "<工具名>",
    "description": "<说明>",
    "input_preview": "<实际参数预览>"
  }
}
```

channel 发回 Claude Code：【文档明确】【源码明确】同上。

```json
{
  "method": "notifications/claude/channel/permission",
  "params": {
    "request_id": "<对应ID>",
    "behavior": "allow"
  }
}
```

拒绝使用 `behavior:"deny"`。官方插件文本解析式为 `/^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i`，ID 五字母、排除 `l`；接受大小写后，回传前用 `match[2].toLowerCase()` 归一化ID。匹配后消耗该条消息，不再作为普通 prompt。近似文本仍是聊天，不能把“好的”“yes”或转发正文里的片段当批准。【源码明确】Telegram `server.ts:89`、`:930`；Discord `server.ts:75`、`:833`。[TG-Source] [DC-Source]

终端与 channel 首答生效；项目 trust、MCP server consent 不在中继范围。`description` 不保证带实际命令，官方建议有空间时展示 `input_preview`，并非要求所有提示完整显示。文档说明新版本会做部分净化／脱敏，但不保证全覆盖。v2.1.234 后只向本会话已注册 channel 中继；省略permission capability即不启用，v2.1.234起也可设为 `false`，此前 `false` 仍会被视为已声明。【文档明确】[CC-Reference] 本插件宜要求展示足以判断操作的参数预览，属于本地产品策略。【推断】

微信实现建议：权限请求正文包含工具名、必要参数预览和 `yes <id>` / `no <id>`；本地记录 pending ID、账号与允许审批的 sender，在回复时重新检查 allowlist、disabled 状态、ID 和有效状态。不能让普通聊天授权自动等于审批权限；也不能因未发出微信提示而阻断终端原有审批。【推断】

### 5.3 本机官方插件与上游版本核对

已读取本机指定 Telegram／Discord 目录内源码、README、ACCESS、configure/access skills、manifest、MCP 配置、包文件与锁文件。本机 marketplace 目录无 `.git`，所以**无法报告本机安装来源 commit**；但两个插件目录共 **22 个文件**计算出的 Git blob SHA，与上游 `f75f5b25ae94f4332be4ff5f18435741d2589bdb`（2026-11-13 00:10:35 UTC）的 tree 全部一致。下面引用该固定提交，不把它冒称为本机历史 commit。【源码明确】【未验证】[CC-Plugins-Commit] [TG-Dir] [DC-Dir]

| 对象 | Telegram | Discord |
| --- | --- | --- |
| 插件 manifest 版本 | `0.0.7` | `0.0.4` |
| package / MCP server 自报版本 | `0.0.1` / `1.0.0` | `0.0.1` / `1.0.0` |
| 锁定 MCP SDK | `1.27.1` | `1.27.1` |
| 平台 SDK | `grammy@1.41.1` | `discord.js@14.25.1` |
| LICENSE | Apache-2.0 | Apache-2.0 |
| server.ts Git blob SHA | `6bc0ebc6a545838789552ca6d8d6e38a43ba5314` | `0595fc7ecf2f974a7c7f4f743ab8d3b1dd7f0918` |

本表均【源码明确】，对应固定提交的 `.claude-plugin/plugin.json`、`package.json`、`server.ts`、`bun.lock`、`LICENSE`。[TG-Dir] [DC-Dir]

### 5.4 Telegram、Discord 主要行为逐项对照

下表样板行为均【源码明确】，行号以 [TG-Source] / [DC-Source] 为准；微信取舍均为基于第 3 节证据的【推断】，不是已实现或实测通过。

| 行为 | Telegram | Discord | 微信取舍 |
| --- | --- | --- | --- |
| 默认访问策略 | pairing，空全局 allowlist、空 groups（128–135） | 相同（123–130） | **可沿用。** 扫码登录与授予本地 Claude 访问权分层处理；首版本人优先。 |
| pairing code | 3 random bytes→6 hex；1h；pending≤3；同 sender 最多初次与一次提醒（236–275） | 基本相同（236–273） | **可沿用本地机制。** 配对码 TTL 不等于微信 context TTL。 |
| 本地批准与通知 | access skill 批准、写 marker；5s 扫描，发确认后无论成功失败都删 marker（335–361） | 相同原则（320–367） | **需改发送。** 延迟批准可能失去发送窗口，不能无限补发确认。 |
| allowlist 重读 | 每次入站重读；static 模式快照、禁用新 pairing（156–200） | 同类（151–193） | **可沿用。** 撤销与 disabled 同时限制入站、出站和审批。 |
| sender 与会话 ID | DM chat_id 与 user_id 对应（202–209） | DM channel ID 另映射 recipient（402–415） | **需改。** 以 account + from_user_id 授权，不靠昵称或假定 chat ID 等于 owner。 |
| 连接 | grammy `Bot.start()` 长轮询（1001–1045） | discord.js Gateway login（81–90、893–900） | **Telegram 最接近。** 换成 iLink HTTPS、游标、账号失效、错误码逻辑。 |
| 群 | 显式 opt-in，局部 allowFrom 空可放群成员 | 同类，并有 mention 控制 | **首版做不到／不做。** 官方微信插件仅 direct，不能照搬群能力。 |
| 入站附件时机 | gate 后立即下载图片；document/voice/audio/video 等只交 file ID（798–889、913–966） | 全部先交元数据，延迟下载（862–885） | **以 QQ／Discord 懒下载为起点。** 若 CDN TTL 短，改成门禁后缓存，不能未授权就下载。 |
| 下载工具 | 按 file_id 调 getFile（606–622） | 先按 chat/message ID 重新取消息（692–706） | **需改。** 微信无公开 history fetch；缓存最近消息的媒体描述或本地文件。 |
| 下载安全 | 清理 ID／扩展名 | 生成 inbox 名、25 MiB 检查（418–438） | **可沿用原则，限额重定。** 实际字节计数、路径和 URL 规则需增加。 |
| 出站文件保护 | realpath 后拒发 state，inbox 例外；检查目标（140–153、202–209） | 同类（139–148、402–415） | **可沿用。** 防发送 token、allowlist、二维码状态和缓存数据库。 |
| 出站附件 | ≤50 MiB；sendPhoto / sendDocument，文本后独立发送（542–591） | ≤10 件，每件25 MiB，附首段（614–645） | **需重写上传。** iLink 获取上传 URL、加密、CDN、sendmessage；不能继承这两个平台限额。 |
| 文本分块 | ceiling4096；length/newline（363–385、550–574） | ceiling2000（369–392、623–649） | **需改。** 微信4000仅官方客户端策略；顺序、Unicode、部分成功需处理。 |
| Markdown | 默认纯文本，可显式 MarkdownV2（474–477） | content 直接发送 | **需改。** 微信有限文本 Markdown 子集，实测后决定；不复制 QQ 拒绝后自动换格式重发。 |
| typing | 普通入站发一次，注释约5秒（952–953） | 发一次，注释约10秒（851–854） | **有接口，可实现。** 微信 getconfig / sendtyping；实际持续时长未知，不能称持续全任务。 |
| 权限提示 | 给全局允许者 DM，See more / Allow / Deny 按钮（420–452、735–791） | 同类按钮（469–518、744–802） | **改成文本。** 没有核实微信原生按钮接口，文本审批足够。 |
| 文本审批 | 严格 yes/no + ID，匹配后发 verdict | 同类 | **可沿用解析，强化独立审批 gate。** 正文和图片里看起来像批准的内容不执行。 |
| 编辑、reaction、历史 | react/edit；此插件未暴露通用 history 工具 | react/edit、fetch_messages≤100 | **首版不可提供。** 微信未找到对应公开 API，本地缓存必须说明其范围。 |
| 缺凭据 | exit(1)（47–54） | exit(1)（56–63） | **采用 QQ 的改进。** 保持 MCP 加载并说明待配置，避免用户找不到原因。 |
| 安装行为 | start 先 bun install，再 server；带强制 npmjs `.npmrc` | 同类 | **不照搬。** 采用本仓库 lockfile、用户 registry、自包含包约定。 |

访问管理 skill 均要求只处理本地终端用户的访问变更请求；外部 channel 消息不能授权其自行加入 allowlist。这也是微信 configure/access skill 必须保留的边界。【源码明确】【推断】[TG-Access] [DC-Access]

**生命周期不能简单写成两个官方插件都一样：**

- Telegram 会读 `bot.pid`，发现另一个存活 PID 且 `ps` 命令行包含 `server.ts` 就 SIGTERM，再记录自己；没有按 bot token 严格核对旧进程。stdin end/close、SIGTERM、SIGINT、SIGHUP 会调用 `bot.stop()`、清理自己的 PID，2 秒强退；另有每 5 秒 stdin watchdog。【源码明确】Telegram `server.ts:58`、`:652`。[TG-Source]
- Telegram 轮询错误重试上限延迟15秒；409 且 attempt≥8 时日志写“Exiting”，实际只 return 轮询 IIFE，没有 `process.exit`，可能留下 MCP 连接但不再收信。不要把日志文案当已退出证据。【源码明确】【推断】Telegram `server.ts:1001`。[TG-Source]
- Discord 对 stdin end/close、SIGTERM、SIGINT 调 `client.destroy()`，2 秒强退；没有同样的 PID 抢占、SIGHUP 或 watchdog。底层 reconnect/resume 交给 discord.js，本次未继续审计 SDK 内全部路径。【源码明确】【未验证】Discord `server.ts:723`。[DC-Source]
- 微信应借用限时退出和独占运行原则，不能照抄“看见 server.ts PID 就杀”；同账号多连接语义未知，应先阻止冲突或明确交接，再用实测确定策略。【推断】

**样板源码与更严格目标之间的差异：** 两插件普通群 gate 在局部 `allowFrom=[]` 时可放行群成员，文本审批在通过普通 gate 后没有再次强制全局 allowFrom／DM；按钮路径则检查全局 allowFrom。另外，出站 gate 和权限请求广播未统一把 `dmPolicy=disabled` 当作拒绝条件。微信首版应保留 QQ 已补齐的 disabled 出站检查，并单独限制审批者；不要把这些简化实现当安全要求本身。【源码明确】【推断】Telegram `server.ts:204`、`:278`、`:438`、`:930`；Discord `server.ts:405`、`:276`、`:487`、`:833`。[TG-Source] [DC-Source]

### 5.5 对照 QQ spec 的 55 条用户故事

沿用企微调研 A9 的“功能—可行性—差异”写法。编号对应 [QQ-Spec]；表中判断均【推断】，平台证据见第 3 节、channel 契约见 5.1–5.2。**本地可行**表示主要由插件实现；**有条件**不是账号实测已通过。

| # | QQ 功能 | 微信判断 | 差异或条件 |
| ---: | --- | --- | --- |
| 1 | marketplace 安装 | 本地可行 | 新增独立微信插件；此次不修改 marketplace。 |
| 2 | lockfile 自动安装依赖 | 本地可行 | 所有外部依赖来自 npm，锁定兼容版本。 |
| 3 | 尊重用户 registry | 本地可行 | 不附强制 registry 配置。 |
| 4 | 平台设置说明 | 可行，需改 | 写 ClawBot 入口、扫码与 PIN／实名条件，不写 QQ WebSocket 控制台设置。 |
| 5 | 一条 configure 配凭据 | 需改 | 变为独立交互登录和状态管理，没有 AppID/AppSecret 流程。 |
| 6 | 凭据私有权限 | 本地可行 | 目录0700、文件0600；不能把 Bot token 交给模型。 |
| 7 | 脱敏显示配置状态 | 本地可行 | 仅是否登录／需重新登录／连接状态。 |
| 8 | 清除凭据 | 本地可行 | 区分本地删除与服务端撤销；后者未核实专门接口。 |
| 9 | 解释 development flag | 本地可行 | 明确只支持交互式启动，仍须组织策略允许。 |
| 10 | 组织插件 allowlist | 本地可行 | 按本插件标识设置 allowedChannelPlugins。 |
| 11 | 中英文 README | 本地可行 | 延续仓库规范。 |
| 12 | 会话启动即连接 | 有条件 | 凭据有效后开始 iLink 长轮询。 |
| 13 | 断线恢复 | 有条件 | 恢复轮询和游标可实现；离线保留、漏消息与重投边界需测。 |
| 14 | 自动刷新 token | **未证实同等能力** | 没有 QQ 两小时 refresh 模型；微信凭据寿命和重扫码条件未知。 |
| 15 | 缺失／拒绝凭据报错 | 本地可行 | 区分网络、业务拒绝、会话失效，不泄漏响应中的凭据。 |
| 16 | 缺凭据保持加载 | 本地可行 | MCP 待配置，不启动忙循环。 |
| 17 | 日志不含秘密 | 本地可行 | 遮盖 Bot/context token、二维码、PIN、CDN参数和媒体 key。 |
| 18 | 未知 sender 获配对码 | 有条件 | 平台首先要允许其消息到达；配对回复依赖入站 context。 |
| 19 | 终端批准配对 | 本地可行 | 微信消息不能替代本地审批。 |
| 20 | 配对成功通知 | 有条件 | 迟到审批时 context 可能过期；失败在终端说明。 |
| 21 | 配对码过期 | 本地可行 | 配对码与微信上下文的 TTL 分开。 |
| 22 | pending 上限／抑制重复发码 | 本地可行 | 可用官方样板3个pending、最多两次通知策略。 |
| 23 | 未授权消息不进 Claude | 本地可行 | gate 放在下载、命令、审批和通知前。 |
| 24 | 列出授权人 | 本地可行 | 只在本地显示必要身份。 |
| 25 | 撤销授权 | 本地可行 | 入站、工具出站、审批即时统一生效。 |
| 26 | pairing 切 closed allowlist | 本地可行 | 完成本人配置后推荐 closed allowlist。 |
| 27 | disabled 完全暂停 | 本地可行 | 同时阻止发送和权限广播。 |
| 28 | 权限只从终端修改 | 本地可行 | skills、server instructions 与实际写入路径都需约束。 |
| 29 | 私聊文本进 Claude | 有条件 | iLink 已有协议与官方实现，具体账号能力待测。 |
| 30 | sender／message／timestamp | 可映射 | `from_user_id`、无损 `message_id`、`create_time_ms`；引用 `svr_id` 另存，不能混当当前消息ID。 |
| 31 | 收图片 | 有条件 | 门禁后解密下载；URL／key有效期需测。 |
| 32 | 收文件 | 有条件 | 同上，加文件名、大小和写入边界。 |
| 33 | 只通知摘要，不预下载 | 部分可行 | 下载引用寿命决定是否改为门禁后预缓存。 |
| 34 | 按需下载工具 | 可实现 | 有界保存入站引用；失忆或过期报错，不虚构历史接口。 |
| 35 | 专属 inbox 与安全名 | 本地可行 | 生成文件名、真实路径检查、逐块限额。 |
| 36 | 重复消息只交付一次 | 本地可行但有限 | 持久化去重与游标；不承诺外部动作 exactly-once。 |
| 37 | 回复同一私聊 | 有条件 | account、sender、context 一致；每次出站再 gate。 |
| 38 | 优先 Passive reply | **需重写** | 微信没有已证实的 QQ 被动／主动两套选择模型。 |
| 39 | 过窗后 Proactive 兜底 | **未证实可行** | 不能保证长任务完成通知；不能套60min／4条常量。 |
| 40 | 失败明确返回 | 本地可行 | 表达缺context、业务拒绝、部分成功、结果未知。 |
| 41 | 失败不后台补发 | 本地可行 | 不隐式排队／换ID重试，避免重复消息。 |
| 42 | 长文顺序分段 | 有条件 | 本地分块可做；4000仅官方插件值，长度语义和发送额度需测。 |
| 43 | 发≤5 MB图片／文件 | 有条件 | 可设本地5MB限额，但微信实际上传／接收限制待测。 |
| 44 | 超限清晰报错 | 本地可行 | 发送前检查，不能把本地限额标为微信硬限额。 |
| 45 | 禁发状态目录 | 本地可行 | realpath防符号链接；inbox作为明确例外。 |
| 46 | 仅发给 allowlist | 本地可行 | 不接受任意to_user_id即可投递的假设。 |
| 47 | 声明编辑／反应／历史不可用 | 可行 | 当前无已确认公开接口；本地quote cache另行说明。 |
| 48 | 手机权限提示 | 有条件 | 受context窗口影响；显示工具和必要input_preview。 |
| 49 | yes/no + ID审批 | 本地可行 | 文本即可，不依赖按钮。 |
| 50 | 只有paired sender审批 | 本地可行 | 审批 gate 独立于普通聊天 gate。 |
| 51 | 近似文本不误批准 | 本地可行 | 严格正则、pending核对；未匹配视普通消息。 |
| 52 | 终端／手机首答生效 | 由Claude支持 | 正确发verdict；远端超时不剥夺终端操作。 |
| 53 | 无账号离线测试 | 本地可行 | pairing、gate顺序、游标／去重、context失效、未知发送结果。 |
| 54 | 小型平台接口和fake | 本地可行 | HTTPS/CDN/加密属于微信边界；宿主逻辑分开。 |
| 55 | 可复用逻辑 | 本地可行 | 可复用pairing/gate/权限解析；QQ reply policy不能直接共用。 |

QQ spec 还规定无 workspace/git/file 依赖、状态目录隔离、MCP SDK 1.x、中文对用户文案、平台无关逻辑离线测试、实机 spike 先行。微信可以沿用这些工程约定；QQ 的 WebSocket、两小时 token、60 分钟／4 条、Markdown 拒绝后重发、QQ 5 MB 平台限制都不能移植成微信事实。是否抽取 `packages/core` 属于后续实现决策，本次没有创建它。【源码明确】【推断】[QQ-Spec] [WECOM-Research]

## 6. 已有同类实现，仅作参考

这些仓库只用于了解选型和问题；**没有复制代码、安装或运行项目，也没有完成全量安全审计**。表中【源码明确】对第三方项目仅表示读到其自身源码／元数据，不代表腾讯背书。活跃度以默认分支最新提交时间为依据，不用 star 数代替维护判断。

| 项目 | 接入途径／架构 | 许可证与活跃度 | 可参考的问题与限制 |
| --- | --- | --- | --- |
| [Tencent/openclaw-weixin][WX-README] | 官方 iLink，OpenClaw 插件；不是 Claude MCP | MIT；main `0ad1ae91`，2026-11-09；npm版本见第4节 | **首要协议依据。** 需区分稳定／beta、宿主耦合、窗口未知与实际安全顺序。【文档明确】【源码明确】 |
| [m1heng/claude-plugin-weixin][EX-M1] | iLink + Bun + stdio MCP，默认pairing | package声明MIT，未核验到独立许可证；v0.1.0；commit `d870a097`，2026-03-22 | 接近channel形态；把context_token放到模型元数据、只检查HTTP不检查业务错误，不能照搬。【源码明确】【推断】 |
| [uetuluk/cc-wechat][EX-UET] | iLink + Bun + MCP，文本权限relay | MIT LICENSE；v0.1.1；commit `1c575732`，2026-03-31 | 空allowlist或读取失败时放行全部；审批投递最近sender、缺少本地pending关联核验。只参考功能形态。【源码明确】【推断】 |
| [hao-ji-xing/cc-weixin][EX-HAO] | iLink + Claude Agent SDK，WIP/demo | README声明MIT，未核验独立LICENSE；commit `09985488`，2026-03-23 | 独立agent桥接器，不是当前Claude会话channel；条款镜像不能作为现行官方协议。【源码明确】【推断】 |
| [crazynomad/weixin-claude-bot][EX-CRAZY] | weixin-ilink SDK + Claude Agent SDK，实验教学 | README声明MIT，package无license，未核验独立LICENSE；commit `71c7178a`，2026-03-30 | “日志成功但没收到”记录可转为验收项目，不能提升为统一服务器规则。【源码明确】【未验证】 |
| [UNLINEARITY/CLI-WeChat-Bridge][EX-CLI] | iLink长轮询 + daemon；Claude适配为PTY输入、Hook TCP回调 | LICENSE AGPLv3；README称AGPL-3.0-or-later／商业双许可；commit `614e5354`，2026-11-08 | 可看多会话／状态隔离经验；node-pty与架构不符合轻量stdio MCP目标。这里Hook是Claude回调，**不是微信客户端注入**。【源码明确】【推断】 |
| [NewFuture/openclaw-weixin][EX-NF] | 腾讯上游的社区发行版，同一iLink后端 | MIT；commit `2b98d190`，2026-10-30，最近push为11-08 | 记录业务错误、uint64、重放去重、媒体隔离等问题；非腾讯官方发布，无scope包名不能与腾讯scope包混淆。【源码明确】 |

### 6.1 明确排除的非官方个人号途径

| 名称／类别 | 排除原因 |
| --- | --- |
| itchat、网页版微信协议类 | 不属于本次官方开放消息API路线；依赖非公开／非受支持登录或消息行为，账号与服务条款风险未排除，且不满足硬约束。【推断】不展开实现。 |
| Wechaty 的非官方 puppet、Gewechat、WeChatPadPro 等协议服务 | 必须按具体puppet／后端判断，框架名称本身不能等同一种协议；凡依赖iPad/Mac私有协议或第三方托管中转者均排除。【推断】不展开实现。 |
| [laolin5564/openclaw-wechat][EX-IPAD] | README明确依赖微信iPad协议服务、Docker、MySQL、Redis；README称MIT，独立许可未核验；commit `457ef3d6`，2026-03-01。违反官方途径与npm-only要求。【源码明确】【推断】 |
| [WeChatFerry][EX-WCF]、PC注入／hook类 | WeChatFerry自述为微信Hook，MIT，2026-07-10归档，最新commit `0f5c60a0` 为03-21。直接违反禁止hook客户端的条件。【源码明确】【推断】 |

不把上述项目笼统称为“违法”。本次足以排除它们的依据是用户硬约束、缺少官方自动化授权证据及不可接受的账号风险；微信通用条款入口本次无法完整读取，因此不伪造条款原文或条号。【未验证】【推断】[WX-General-Terms] [WX-Account-Rules]

## 7. 风险、矛盾与证据缺口

### 7.1 风险判断

| 风险 | 已知依据 | 对本项目的影响与处理 |
| --- | --- | --- |
| 账号与用途资格 | 官方有ClawBot扫码及兼容实现文档，但无本次核验到的完整第三方生产服务条款；账号范围未公开确认。【文档明确】【未验证】 | **P0。** 不能声称维护者真实号零风险。先完成官方用途／客户端资格确认，再决定是否启动账号spike。【推断】 |
| 条款／服务独立于代码许可证 | MIT明确；后端许可公开咨询仍未答复。【文档明确】【未验证】 | 不把MIT当作服务许可，也不反过来把所有兼容实现归为逆向协议。【推断】 |
| 后端收紧或协议变化 | 11月beta新增实名流程、PIN扩展、版本识别规则；协议说明自身不是完整服务端契约。【文档明确】【源码明确】 | 隔离transport，保留版本能力判断和清晰重新配置路径；不依赖未文档化保活或绕过校验。【推断】 |
| 长任务／主动通知中断 | context窗口无官方统一阈值，社区报告互相矛盾。【未验证】 | **P0。** 若超窗无法回发，就不能承诺离开电脑后完整控制Claude；明确降级为短回合或搁置。【推断】 |
| 并发、凭据撤销与重绑定 | 支持多个账号，未确认同token多consumer与旧token撤销语义。【源码明确】【未验证】 | 单账号单进程起步；不自动跨客户端抢占，不共享模糊游标。【推断】 |
| “成功”但未送达 | 社区存在HTTP200/ret0但手机不见消息的报告。【未验证】 | 接口回执和手机观察分开，不能将缺ID直接等同失败，也不能自动重试制造双发。【推断】 |
| 提示注入与远端权限 | channel把外部内容交给本地Claude；官方样板存在较宽的群聊天gate复用路径。【文档明确】【源码明确】 | sender门禁、审批者门禁、出站门禁分开；仅本地修改access，凭据不进模型上下文。【推断】 |
| 媒体与本地资源 | 稳定版整块下载后才交存储限额，且先下载后做sender授权。【源码明确】 | gate前不取CDN；逐块限额、URL及路径校验；拒发状态目录。【推断】 |
| 日志与持久化泄密 | 官方保存Bot token、context token及引用缓存；部分扫码／下载诊断有敏感内容风险，beta也承认URL脱敏尚不完整。【源码明确】【文档明确】 | 不能直接照搬日志；对凭据、QR、PIN、CDN参数、AES key脱敏，状态文件私有权限与有界保留。【推断】 |
| Claude侧可用性 | research preview、平台/组织策略限制，必须保持交互会话在线。【文档明确】 | 微信通道在线不代表Claude能处理；分别显示MCP、微信、会话启用状态，不能承诺后台无人值守服务。【推断】 |

表据：[WX-Protocol] [WX-Beta] [WX-Terms-Question] [WX-Window-202] [WX-Window-286] [WX-Delivery-290] [NPM-Stable] [CC-Channels] [CC-Reference]。

### 7.2 隐私：经过谁、保存在哪里

推荐直连方案中的消息经过**微信／腾讯 iLink**；媒体经过返回的微信 CDN；绑定他人Bot的新实名流程还访问 `weixin110.qq.com`。本机收到内容后交给 Claude Code，再按 Claude 会话所用的模型服务及组织设置处理。这个链路不需要微信协议代理商、收费托管服务或本项目维护者的中转服务器，但并非全部内容只在本机流转。【源码明确】【推断】[WX-Protocol] [CC-Reference]

CDN媒体加密 key 通过同一腾讯消息/API链路分发，且上传申请把 key 发给服务端，所以本报告**没有腾讯不可访问内容的端到端加密保证**。也没有查到可核验的本产品服务端消息／媒体保留期、是否跨境、是否用于训练等完整政策；第三方条款镜像的“不存储输入输出”说法不能写成已核实事实。【源码明确】【未验证】【推断】`2.4.10`，`src/cdn/upload.ts`、`src/messaging/send.ts`；[WX-Terms-Mirror]

本地至少会持有Bot凭据、轮询游标、context token、allowlist／pending、附件及可选引用缓存。`0600` 是操作系统访问权限，不是文件内容加密。若沿用quote cache，它还会持久化对话与附件，不能只在README里说明“只保存登录态”。应在未来实现中明确保留期、清理范围和退出行为；本次没有创建任何这些运行状态文件。【源码明确】【推断】`2.4.10`，`accounts.ts`、`inbound.ts`、`quote-store.ts`。[NPM-Stable]

### 7.3 已发现的矛盾，不自行掩盖

| 矛盾 | 如何使用证据 |
| --- | --- |
| npm latest是2.4.10，main文档包含3.0.0-beta-0 | 分版本引用；不把beta的journal、实名或故障修复写成稳定版已经具备。【源码明确】 |
| 官方protocol表写 `message_id:number`，实际types和parser用无损string | 文档表述与源码不一致；实现按wire uint64无损保留字符串，不能转JS number；后续向官方核验文档。【文档明确】【源码明确】【推断】 |
| protocol仍提测试routeTag `10086`，同commit较新README已改为正常生产服务+功能开关说明 | 不沿用旧测试路由或全量请求日志步骤；记录矛盾，以真实服务状态验证，不猜测试环境行为等于生产。【文档明确】【推断】 |
| beta说明“PIN适配”，稳定2.4.10已有PIN分支 | beta新增／扩展状态与交互，不等于此前完全没有PIN。【源码明确】 |
| 插件Node>=22.13.0，beta undici>=22.19.0 | 最低版本声明不统一；不承诺旧环境兼容，Bun另测。【源码明确】【未验证】 |
| 社区“24h/10条”与“约2分钟失效” | 均不足以固定全局限制；不归因于已证实风控，不拿typing或频繁发消息绕过。【未验证】 |
| 公众号旧文章常见20条，当前官方文档5条 | 按当前官方5条记录，同时保留旧资料过时说明；不要将公众号规则迁到iLink。【文档明确】【推断】 |
| 小程序发送页混有公众号触发动作文案 | 只采用明确的API和配额，不将混入的动作直接视为小程序可触发条件。【文档明确】【未验证】 |
| 旧Claude摘要可能只写claude.ai；现行线上也允许Console API key | 以本次线上channel文档为准，仍区分第三方云提供商限制。【文档明确】 |

对应来源：[WX-Protocol] [WX-README] [NPM-Stable] [NPM-Beta] [WX-Beta] [NPM-Undici] [MP-KF] [MINI-Send] [CC-Channels]。

### 7.4 查不到什么，以及查过哪里

1. **独立客户端的完整官方服务条款／普遍准入授权、账号覆盖表：未找到可核验版本。** 已查 `Tencent/openclaw-weixin` README、协议、LICENSE、发布说明、Issues／Discussions，以及 `tencent.com`、`weixin.qq.com`、`developers.weixin.qq.com`、`wechat.com`、腾讯云产品文档；检索“微信ClawBot功能使用条款”“ClawBot服务协议／用户协议”“ilink terms／第三方／许可”。官方Discussion #324仍显示Unanswered；第三方镜像仅作线索。本次不为读取应用内条款而登录真实账号。【未验证】[WX-Terms-Question] [WX-Terms-Mirror]
2. **明确的bot token TTL／refresh、context token TTL／额度、QPS、媒体URL TTL／平台大小上限、同号多连接规则：未找到完整官方契约。** 已读官方protocol、两版npm源码与README/CHANGELOG，以及相关官方仓库issues。源码常量仅代表客户端行为；没有把社区数字标成官方限制。【未验证】[WX-Protocol] [NPM-Stable] [NPM-Beta] [WX-IP-Question]
3. **个人服务号2026年完整注册规则、未认证公众号完整权限矩阵、测试号人数／期限、独立微信客服准入：未完整核验。** 已查新版subscription/service文档、测试号公开页和腾讯客服注册说明。腾讯客服注册页只取得标题；`kf.weixin.qq.com/api/doc/path/94744`只返回前端壳。没有用旧镜像补成当前事实。【未验证】[MP-Subscription] [MP-Service] [MP-Test] [MP-Registration-Inaccessible] [KF-Independent]
4. **普通个人号任意好友／群消息的官方自动化接口：未找到符合本次约束的公开路径。** 已查微信开放平台、对话平台、公众号、小程序客服、微信客服、企微客户联系与智能机器人。结论限定于所查官方能力，不是证明腾讯内部不存在任何相关服务。【未验证】【推断】第2节来源。
5. **官方微信通用协议与个人账号使用规范正文：网页工具本次无法完整打开。** 不引述未知条号，也不把第三方转载当作现行条款原文。【未验证】[WX-General-Terms] [WX-Account-Rules]

技术文档访问方面，多处微信页面无法由网页搜索工具打开，使用只读HTTP获取官方页面或其官方 `.md` 内容补齐；无法读取的页面保留为缺口。GitHub以固定commit、npm以固定tarball为主，避免把搜索摘要当作完整协议。【源码明确】本次取证方式。

## 8. 后续实机验证清单（按优先级）

以下为**建议的后续spike计划【推断】**，本次全部未执行。先完成不需账号的文档／资格确认，再由维护者决定获准使用的验证账号；不直接让维护者日常真实微信号承担未知客户端风险。每项记录版本、平台、时间、步骤、HTTP／业务结果与手机观察，但不记录真实token、PIN、媒体密钥或真实用户ID到报告／仓库。

| 优先级 | 验证项目 | 通过标准／需要记录的结论 |
| --- | --- | --- |
| **P0-1 文档先行** | 官方条款与客户端资格 | 找到可核验的现行ClawBot条款，或腾讯明确答复本人自用、独立Bun MCP客户端调用iLink的条件；区分代码MIT、兼容标识与生产服务资格。未解决前不把账号spike当默认下一步。 |
| **P0-2** | 本人账号可开通、完整绑定 | 核验微信版本、系统、地区／账号条件，QR→PIN（含服务端强制）→confirmed；确认owner ID、Bot ID、baseurl语义。不得跳过要求的校验。本人绑定不应被误导成必须进行他人实名流程。 |
| **P0-3** | 最小双向文本闭环 | 手机发唯一测试文本，本机poll收到；按实际context回复，手机确认显示。记录HTTP、ret、server message_id及可见结果；ret0本身不算端到端通过。 |
| **P0-4** | 长任务窗口与发送额度 | 在获准的低频范围下，分别测试短回合、约2分钟、5／15／60分钟及更长静默后回复；同context多段、用户再发消息、旧／新context、缺context分别记录。先分清时间与次数，不做高频探测或试图规避限额。 |
| **P0-5** | 权限中继真实流程 | 用户发任务→延迟工具审批→微信看到工具和input_preview→本人yes/no→Claude继续→最终微信回复。验证终端先答、手机先答、取消、旧ID、disabled、撤权与提示发送失败。 |
| **P0-6** | 凭据生命周期 | 正常重启、长时间运行、手机解绑／重绑定后旧token表现；`-14`是否需重扫码、退避后是否恢复。不能用“跑过一次”断言永久登录。 |
| **P0-7** | 同账号多客户端／多poller | 在明确授权后测试第二实例是否拒绝、分流、重复或抢占；旧实例是否继续收发，游标是否相互影响。未完成前只支持单活动消费者。 |
| **P1-1** | Bun基础协议兼容 | 不加载整套OpenClaw：HTTPS/AbortSignal、AES-128-ECB与填充、base64两种key、uint64无损解析、流式上限均通过固定样例；再验证真实收发。若依赖WASM／SQLite，另测对应模块。 |
| **P1-2** | 离线、断网、崩溃和重复投递 | 保存游标前后、通知前后分别中断；恢复不静默丢待处理消息、不自动重复执行已开始任务。无消息ID时明确降级，记录离线保留边界。 |
| **P1-3** | 图片／文件双向与延迟下载 | 图片、普通文件、Unicode文件名、空文件、接近本地限额；立即／延迟下载、URL过期、引用旧附件；解密结果一致，手机可打开。 |
| **P1-4** | 文本格式、拆分和部分成功 | 中文、emoji、代码、表格，在本地保守上限附近测试；记录字符／字节语义、手机显示、顺序、连续消息配额与第N段失败。**不重复QQ曾进行的超大文本客户端破坏性实验。** |
| **P1-5** | gate与状态安全 | 未授权图片不得触发CDN或落盘；撤权／disabled后入站出站和审批都拒绝；路径穿越、符号链接、状态目录附件、恶意URL不能外泄凭据。可主要通过fake离线验证。 |
| **P1-6** | 退出与单进程所有权 | MCP stdin EOF、终端关闭、SIGTERM/SIGINT、强杀后重启；无遗留poller、无错误杀死别的server.ts、无无限收尾。 |
| **P2-1** | typing／语音／视频 | typing持续时间、取消、ticket失效；语音转写字段、SILK兼容和视频播放；失败可降级成文件／文本说明，不谎报支持原生语音发送。 |
| **P2-2** | 引用与本地历史 | 分别测试内嵌引用、ID-only引用、部分引用、本地缓存过期；不把缓存恢复写成平台历史查询，不承诺未测的原生出站引用。 |
| **P2-3** | beta升级与回退 | 新PIN状态、他人绑定的实名流程、journal、下载时限；保留稳定／beta能力差异，不让配置迁移静默丢凭据或重复任务。 |

**进入实现的最低门槛：** P0-1 至 P0-5 有可接受的结论，且P0-6/P0-7至少有明确的保守运行规则。若普通短回复成功但长任务窗口失败，只能宣称“个人短回合问答可用”，不能宣称完整满足QQ规格中的长任务主动回报与远端权限工作流。媒体、群聊、历史等能力不得靠类型声明补齐。【推断】

## 来源列表

以下链接均于2026-11-13查阅。官方文档、固定版本源码、社区问题分组列出；打不开或仅为线索者在正文明确说明。

### 微信 ClawBot 官方文档与 npm 取证

- [WX-Org]：Tencent组织域名验证。
- [WX-Commit]：官方仓库固定commit。
- [WX-README]：该commit的中文README，含安装、绑定、运行与协议入口。
- [WX-Protocol]：该commit的中文后端协议，含客户端契约的局限。
- [WX-Beta]：3.0.0-beta-0绑定与消息处理升级说明。
- [WX-License]：Tencent MIT许可证。
- [WX-CodeBuddy]：腾讯云CodeBuddy《微信ClawBot接入指南》。
- [WX-ClawPro]：腾讯云ClawPro功能发布记录。
- [NPM-Metadata]：官方插件registry完整元数据，含dist-tags与发布时间。
- [NPM-Stable]：2.4.10固定tarball；正文各包内源码路径以此为准。
- [NPM-Beta]：3.0.0-beta-0固定tarball。
- [NPM-CLI]：官方安装器registry元数据。
- [NPM-Undici]：undici@8.10.0的engines元数据。
- [BUN-Compat]：Bun官方Node兼容说明。

### 微信其他官方路线

- [MP-Subscription]、[MP-Subscription-KF]：当前公众号（原订阅号）指南与客服规则。
- [MP-Service]、[MP-Migration]：服务号指南、消息配置与IP白名单。
- [MP-Receive]、[MP-Passive]、[MP-KF]：服务号收消息、被动回复与客服消息。
- [MP-Test]：接口测试号公开申请入口。
- [MP-Registration-Inaccessible]：腾讯客服注册说明；本次仅取得标题，不能用来补齐准入规则。
- [KF-Intro]、[KF-Sync]、[KF-Send]：微信客服概述、接收和发送API。
- [KF-Independent]：微信客服独立平台API入口；本次仅得到前端壳。
- [MINI-KF]、[MINI-Send]：小程序客服入口／推送和发送API。
- [DIALOG]、[OPEN-WX]：对话开放平台与微信开放平台介绍。
- [WECOM-IP]：自建应用开发前必读与可信IP。
- [WECOM-External]、[WECOM-External-Events]：客户联系概述及变更回调。
- [WECOM-Bot]、[WECOM-Bot-Help]：企微智能机器人长连接及内部会话范围。
- [WX-General-Terms]、[WX-Account-Rules]：微信通用协议／个人账号规则入口；本次未完整取得正文。

### Claude Code 官方材料和本仓库基线

- [CC-Channels]、[CC-Reference]：本次线上文档，优先于旧摘要。
- [CC-Plugins-Commit]：2026-11-13的官方插件提交。
- [TG-Dir]、[TG-Source]、[TG-Access]：Telegram插件目录、server与access skill。
- [DC-Dir]、[DC-Source]、[DC-Access]：Discord对应材料。
- [QQ-Spec]：QQ完整规格与55个用户故事；不是微信事实来源。
- [QQ-Research]、[WECOM-Research]：仓库既有研究；后者A9提供对照表格式。

### 社区证据与同类项目（不能标为官方服务保证）

- [WX-Terms-Question]：官方仓库Discussion #324的后端使用条款咨询，未获公开答复。
- [WX-Terms-Mirror]：个人仓库的ClawBot条款镜像，真实性与现行性未由官方URL核验。
- [WX-Window-202]、[WX-Window-286]：互相不同的窗口／条数报告。
- [WX-IP-Question]：多账号与出口IP规则咨询。
- [WX-Delivery-290]、[WX-Delivery-303]、[WX-Delivery-343]：接口成功但手机未收到的用户报告。
- [EX-M1]、[EX-UET]、[EX-HAO]、[EX-CRAZY]、[EX-CLI]、[EX-NF]：第6节项目固定提交；各项目的README／manifest／LICENSE在对应tree内。
- [EX-NF-Distribution]：NewFuture明确说明其为非官方社区发行版。
- [EX-IPAD]、[EX-WCF]：第6.1节排除项目的固定提交／仓库状态。

[WX-Org]: https://github.com/Tencent
[WX-Commit]: https://github.com/Tencent/openclaw-weixin/commit/0ad1ae91347a938f52f1e4e2abd6dcda51e05f9e
[WX-README]: https://github.com/Tencent/openclaw-weixin/blob/0ad1ae91347a938f52f1e4e2abd6dcda51e05f9e/README.zh_CN.md
[WX-Protocol]: https://github.com/Tencent/openclaw-weixin/blob/0ad1ae91347a938f52f1e4e2abd6dcda51e05f9e/docs/protocol_zh_CN.md
[WX-Beta]: https://github.com/Tencent/openclaw-weixin/blob/0ad1ae91347a938f52f1e4e2abd6dcda51e05f9e/docs/release-notes-bot-realname-auth_zh_CN.md
[WX-License]: https://github.com/Tencent/openclaw-weixin/blob/0ad1ae91347a938f52f1e4e2abd6dcda51e05f9e/LICENSE
[WX-CodeBuddy]: https://cloud.tencent.com/document/product/1831/137450
[WX-ClawPro]: https://cloud.tencent.com/document/product/213/130654
[NPM-Metadata]: https://registry.npmjs.org/@tencent-weixin%2fopenclaw-weixin
[NPM-Stable]: https://registry.npmjs.org/@tencent-weixin/openclaw-weixin/-/openclaw-weixin-2.4.10.tgz
[NPM-Beta]: https://registry.npmjs.org/@tencent-weixin/openclaw-weixin/-/openclaw-weixin-3.0.0-beta-0.tgz
[NPM-CLI]: https://registry.npmjs.org/@tencent-weixin%2fopenclaw-weixin-cli
[NPM-Undici]: https://registry.npmjs.org/undici/8.10.0
[BUN-Compat]: https://bun.sh/docs/runtime/nodejs-compat
[MP-Subscription]: https://developers.weixin.qq.com/doc/subscription/guide/
[MP-Subscription-KF]: https://developers.weixin.qq.com/doc/subscription/guide/product/kf/intro.md
[MP-Service]: https://developers.weixin.qq.com/doc/service/guide/
[MP-Migration]: https://developers.weixin.qq.com/doc/service/guide/dev/migration.md
[MP-Receive]: https://developers.weixin.qq.com/doc/service/guide/product/message/Receiving_standard_messages.html
[MP-Passive]: https://developers.weixin.qq.com/doc/service/guide/product/message/Passive_user_reply_message.md
[MP-KF]: https://developers.weixin.qq.com/doc/service/guide/product/kf/intro.md
[MP-Test]: https://mp.weixin.qq.com/debug/cgi-bin/sandbox?t=sandbox/login
[MP-Registration-Inaccessible]: https://kf.qq.com/touch/sappfaq/230829mYveAr230829UrYjUb.html
[KF-Intro]: https://developer.work.weixin.qq.com/document/path/94638
[KF-Sync]: https://developer.work.weixin.qq.com/document/path/94670
[KF-Send]: https://developer.work.weixin.qq.com/document/path/94677
[KF-Independent]: https://kf.weixin.qq.com/api/doc/path/94744
[MINI-KF]: https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/customer-message/customer-message.html
[MINI-Send]: https://developers.weixin.qq.com/miniprogram/dev/server/API/kf-mgnt/kf-message/api_sendcustommessage.md
[DIALOG]: https://developers.weixin.qq.com/doc/aispeech/platform/INTRODUCTION.html
[OPEN-WX]: https://developers.weixin.qq.com/doc/oplatform/open/intro.html
[WECOM-IP]: https://developer.work.weixin.qq.com/document/path/90664
[WECOM-External]: https://developer.work.weixin.qq.com/document/path/92109
[WECOM-External-Events]: https://developer.work.weixin.qq.com/document/path/92129
[WECOM-Bot]: https://developer.work.weixin.qq.com/document/path/101463
[WECOM-Bot-Help]: https://open.work.weixin.qq.com/help2/pc/21663
[WX-General-Terms]: https://weixin.qq.com/cgi-bin/readtemplate?lang=zh_CN&t=weixin_agreement
[WX-Account-Rules]: https://weixin.qq.com/agreement/personal_account
[CC-Channels]: https://code.claude.com/docs/en/channels
[CC-Reference]: https://code.claude.com/docs/en/channels-reference
[CC-Plugins-Commit]: https://github.com/anthropics/claude-plugins-official/commit/f75f5b25ae94f4332be4ff5f18435741d2589bdb
[TG-Dir]: https://github.com/anthropics/claude-plugins-official/tree/f75f5b25ae94f4332be4ff5f18435741d2589bdb/external_plugins/telegram
[TG-Source]: https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/external_plugins/telegram/server.ts
[TG-Access]: https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/external_plugins/telegram/skills/access/SKILL.md
[DC-Dir]: https://github.com/anthropics/claude-plugins-official/tree/f75f5b25ae94f4332be4ff5f18435741d2589bdb/external_plugins/discord
[DC-Source]: https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/external_plugins/discord/server.ts
[DC-Access]: https://github.com/anthropics/claude-plugins-official/blob/f75f5b25ae94f4332be4ff5f18435741d2589bdb/external_plugins/discord/skills/access/SKILL.md
[QQ-Spec]: ../../qq-channel/spec.md
[QQ-Research]: ../../../docs/research/qq-bot-and-channels.md
[WECOM-Research]: ../../../docs/research/wecom-bot-and-channels.md
[WX-Terms-Question]: https://github.com/Tencent/openclaw-weixin/discussions/324
[WX-Terms-Mirror]: https://github.com/hao-ji-xing/cc-weixin/blob/099854885b3ef56fea6537b97b50bcb3b5a21aed/protocol.md
[WX-Window-202]: https://github.com/Tencent/openclaw-weixin/issues/202
[WX-Window-286]: https://github.com/Tencent/openclaw-weixin/issues/286
[WX-IP-Question]: https://github.com/Tencent/openclaw-weixin/issues/212
[WX-Delivery-290]: https://github.com/Tencent/openclaw-weixin/issues/290
[WX-Delivery-303]: https://github.com/Tencent/openclaw-weixin/issues/303
[WX-Delivery-343]: https://github.com/Tencent/openclaw-weixin/issues/343
[EX-M1]: https://github.com/m1heng/claude-plugin-weixin/tree/d870a097ca7ae82977b7b32cfccc4a5991a405d0
[EX-UET]: https://github.com/uetuluk/cc-wechat/tree/1c575732cb85887583f91c5dbb2b839a6d319b8b
[EX-HAO]: https://github.com/hao-ji-xing/cc-weixin/tree/099854885b3ef56fea6537b97b50bcb3b5a21aed
[EX-CRAZY]: https://github.com/crazynomad/weixin-claude-bot/tree/71c7178a0e7de7368a3bb1c4b2649721cce6c716
[EX-CLI]: https://github.com/UNLINEARITY/CLI-WeChat-Bridge/tree/614e53546894a80cd66a3504b4db308e1d518ade
[EX-NF]: https://github.com/NewFuture/openclaw-weixin/tree/2b98d19013ce5cebbddd7177eb3c2760e71f3d48
[EX-NF-Distribution]: https://openclaw-weixin.newfuture.cc/en/distributions.html
[EX-IPAD]: https://github.com/laolin5564/openclaw-wechat/tree/457ef3d6cb2888aece7f691cc9d39247acfe19a3
[EX-WCF]: https://github.com/lich0821/WeChatFerry


