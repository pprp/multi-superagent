# Multi-SA · dsh-multi-superagent

[中文](README.md) · [English](README.en.md)

> **仅供研究参考的原型，非 DeepSeek 官方产品。** 代码来自团队日常开发，大量工程由 coding agent 完成。请当作研究代码，不要当成生产级软件；可能仍有缺陷，风格与工程实践也不统一。接入自己的环境前请先审阅并改写。
>
> 为公开做了适配，与内部版本及文章 *Exploring Super-agent Design: Towards a More Autonomous Agent System* 中的实现并不完全一致。文中部分设计属于后续方向，本原型尚未实现。

**Multi-SA** 是挂在 [DeepSeek Harness](https://www.deepseek.com/en/harness/) 上的**多项目** Superagent 插件（包名 `dsh-multi-superagent`）。一个进程里管多个项目：每个项目对应自己的 GitHub 仓库（可选飞书），各自做鉴权、开 Ticket、在独立 Session 与工作目录里干活，并回到原对话回复（例如开 PR）。Web 面板按项目展示进度与待人工事项。

它也是一种用法：**尽量少占人的注意力，尽量多交付有用结果。** 能替整队行动的 agent，也可能浪费整队注意力——因此只在有人点名、或团队写好的规则允许时行动；只在必须有人出手、或结果值得看时说话。原则见 [docs/000-philosophy.md](docs/000-philosophy.md)。

## 和单仓 dsh-superagent 的区别

| | 单仓 `dsh-superagent` | Multi-SA（本仓） |
|---|---|---|
| 范围 | 一个 GitHub 仓库 | 多个项目，每项目一个仓库 |
| DSH profile | `superagent` | **`multi-sa`（独立）** |
| 面板口 | `127.0.0.1:3082` | `127.0.0.1:3084` |
| 状态目录 | `~/.dsh/state/superagent` | `~/.dsh/state/multi-sa` |
| 控制脚本 | 单仓里的 `scripts/dsh-superagent` | 本仓 `scripts/dsh-superagent`（默认口 3084） |

**不要**把两个包装进同一个 profile：各自改进程级 `PATH` / git 设置，需要独立重启。详情见 [docs/006-deployment.md](docs/006-deployment.md) 的「独立 profile 部署」。

## 快速开始

本地已有 DSH、模型与本仓检出时：

```sh
# 仅首次：建独立 profile 并挂上本仓
dsh multi-sa --from-default-profile web --dump-config > /dev/null
dsh plugin --profile multi-sa add "link:$PWD"
# 再在 ~/.dsh/profiles/multi-sa/cordis.patch.yml 配 webserver(3084)、stateDir、模型

cd /path/to/multi-sa
scripts/dsh-superagent start
scripts/dsh-superagent status
```

面板链接在最新启动日志里的 `dsh web: http://127.0.0.1:3084/?token=…`。

一步一步装（含账号、Sources、Policy）：让 coding agent 读 [SETUP.md](SETUP.md)，按里面的问答与你一起做。

## 文档

按编号顺序读；后文只依赖前文。

1. [000 哲学](docs/000-philosophy.md)
2. [001 领域模型](docs/001-domain.md)
3. [002 鉴权](docs/002-authorization.md)
4. [003 执行](docs/003-execution.md)
5. [004 提示词](docs/004-prompts.md)
6. [005 面板](docs/005-panel.md)
7. [006 部署](docs/006-deployment.md) — 安装、配置、升级、排障（含 Multi-SA 独立 profile）
8. [007 架构](docs/007-architecture.md)
9. [008 Cookbook](docs/008-cookbook.md) — 加 Source

## 开发

```sh
pnpm check   # 类型检查 + 测试 + 构建
```

## 许可

[MIT](LICENSE)
