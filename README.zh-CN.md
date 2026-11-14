# cc-channels

[English](README.md)

[![test](https://github.com/litterbear520/cc-channels/actions/workflows/test.yml/badge.svg)](https://github.com/litterbear520/cc-channels/actions/workflows/test.yml) [![licence](https://img.shields.io/badge/licence-Apache--2.0-blue)](LICENSE)

一个 Claude Code 插件 marketplace：把即时通讯 Platform 接到正在运行的 Claude Code 会话上，每个 Platform 一个插件。

每个插件包含一个 Channel：一个本地 MCP server，把 Platform 上的消息推进你的会话，并让 Claude 在那边作答。Channel 由本机主动向外连接，不需要公网地址、隧道或服务器。

> **⚠️ 必须带开发标志启动 Claude Code。** Channels 还是研究预览，Claude Code 只加载 Anthropic 名单上的 Channel 插件，这里的插件不在名单上。请按各插件 README 里的方式启动，例如：
>
> ```bash
> claude --dangerously-load-development-channels plugin:qq@cc-channels
> ```
>
> Channel 把外部消息交给一个拥有你本机权限的 agent。让自己以外的人能联系它之前，先读一遍插件的访问控制文档。

## 插件

| 插件 | Platform | 功能 | 文档 |
| --- | --- | --- | --- |
| [`qq`](plugins/qq) | QQ，使用官方 QQ 机器人 API | 单聊和群聊：双向的文字、图片和文件，引用，撤回，在 QQ 里回答工具权限请求 | [README](plugins/qq/README.zh-CN.md) · [访问控制](plugins/qq/ACCESS.zh-CN.md) |

## 安装

在 Claude Code 里添加这个 marketplace，再从中安装插件：

```
/plugin marketplace add litterbear520/cc-channels
/plugin install qq@cc-channels
```

之后按插件自己的 README 配置凭据、完成 Pairing。

## 目录结构

```
cc-channels/
├── .claude-plugin/
│   └── marketplace.json     # marketplace 清单：每个插件一项
├── plugins/
│   └── qq/
│       ├── .claude-plugin/
│       │   └── plugin.json  # 插件元数据
│       ├── .mcp.json        # 启动 Channel
│       ├── server.ts        # Channel 的入口
│       ├── src/             # Channel 本体，按职责分模块
│       ├── skills/          # /qq:configure 和 /qq:access
│       ├── test/
│       ├── README.md
│       └── ACCESS.md
├── docs/
│   ├── adr/                 # 架构决定
│   ├── research/            # 对真实 Platform 的核实记录
│   └── release-checklist.md
└── GLOSSARY.md              # 代码和文档使用的术语
```

插件之间不共享代码：每个插件独立，可以单独安装、单独发版、单独移除。见 [ADR 0001](docs/adr/0001-one-plugin-per-platform.md)。

## Team 和 Enterprise

Team 和 Enterprise 组织默认关闭 Channels，需要 Owner 用托管设置 `channelsEnabled` 打开。管理员还可以把这个 marketplace 里的插件写进组织的 `allowedChannelPlugins` 设置，成员就能用 `--channels plugin:qq@cc-channels` 启动，不再需要开发标志。这项设置会整体替换 Anthropic 的默认名单，而不是在其上追加，所以要把组织需要的每个 Channel 插件都列进去。开发标志只跳过 allowlist，`channelsEnabled` 仍然适用。设置的具体格式见 [Claude Code 的 Channels 文档](https://code.claude.com/docs/en/channels)。

## 开发

```bash
cd plugins/qq
bun install
bun test
bun run typecheck
```

测试不需要 Platform 的账号：与 Platform 的连接放在一个接口后面，测试时用假的实现代替。真实连接按 [docs/release-checklist.md](docs/release-checklist.md) 手工检查。代码和文档里的术语定义在 [GLOSSARY.md](GLOSSARY.md)。提交 pull request 前请看 [CONTRIBUTING.md](CONTRIBUTING.md)，报告安全问题见 [SECURITY.md](SECURITY.md)。

## 许可证

[Apache-2.0](LICENSE)
