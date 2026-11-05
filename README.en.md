# Multi-SA · dsh-multi-superagent

[中文](README.md) · [English](README.en.md)

> **Research prototype for reference only, not an official DeepSeek product.** This code grew out of our team's day-to-day development work, with much of the engineering done by coding agents. Treat it as research code, not production-ready software. It may still contain bugs, and its coding style and engineering practices may be inconsistent. Review and adapt it before using it in your own environment.
>
> We have adapted it for publication, so it is not identical to our internal version or the implementation described in *Exploring Super-agent Design: Towards a More Autonomous Agent System*. Some designs discussed in the article are directions for future development and are not implemented in this prototype.

**Multi-SA** is a **multi-project** Superagent bundle (`dsh-multi-superagent`) for [DeepSeek Harness](https://www.deepseek.com/en/harness/). One process hosts many projects: each project binds its own GitHub repository (and optional Feishu bot), evaluates requests under its Policy, turns authorized ones into Tickets, runs each Ticket in its own Session and work directory, and replies in the original conversation—often with a pull request. The web panel shows progress and human attention per project.

It is also a way of working with an agent: **take as little human attention as possible, and give as much value as possible.** An agent that can act for a whole team can also waste a whole team's attention, so it acts only when asked or when a rule the team wrote allows it, and speaks only when someone must act or can use a result. [docs/000-philosophy.md](docs/000-philosophy.md) explains the principle.

## vs single-repo dsh-superagent

| | Single-repo `dsh-superagent` | Multi-SA (this repo) |
|---|---|---|
| Scope | One GitHub repository | Many projects, one repo each |
| DSH profile | `superagent` | **`multi-sa` (standalone)** |
| Panel | `127.0.0.1:3082` | `127.0.0.1:3084` |
| State dir | `~/.dsh/state/superagent` | `~/.dsh/state/multi-sa` |
| Control script | that repo's `scripts/dsh-superagent` | this repo's `scripts/dsh-superagent` (defaults to 3084) |

**Do not** load both bundles in the same profile: each owns process-wide `PATH` / git settings and needs its own restarts. See the independent-profile section in [docs/006-deployment.md](docs/006-deployment.md).

## Quick start

When DSH, a model provider, and this checkout are ready:

```sh
# First time only: create the profile and link this checkout
dsh multi-sa --from-default-profile web --dump-config > /dev/null
dsh plugin --profile multi-sa add "link:$PWD"
# Then set webserver (3084), stateDir, and models in
# ~/.dsh/profiles/multi-sa/cordis.patch.yml

cd /path/to/multi-sa
scripts/dsh-superagent start
scripts/dsh-superagent status
```

Open the `dsh web: http://127.0.0.1:3084/?token=…` URL from the latest start log.

For a guided install (accounts, Sources, Policy), ask your coding agent to read [SETUP.md](SETUP.md) and walk through it with you.

## Documentation

Read the numbered docs in order; each builds only on earlier ones.

1. [000 Philosophy](docs/000-philosophy.md)
2. [001 Domain model](docs/001-domain.md)
3. [002 Authorization](docs/002-authorization.md)
4. [003 Execution](docs/003-execution.md)
5. [004 Prompts](docs/004-prompts.md)
6. [005 Panel](docs/005-panel.md)
7. [006 Deployment](docs/006-deployment.md) — install, config, upgrades, troubleshooting (incl. Multi-SA profile)
8. [007 Architecture](docs/007-architecture.md)
9. [008 Cookbook](docs/008-cookbook.md) — adding a Source

## Development

```sh
pnpm check   # typecheck, tests, and build
```

## License

[MIT](LICENSE)
