/**
 * Shared worker environment of Multi-SA. `process.env` is one per DSH process, so instead of each project prepending its own
 * shim directory and git configuration, the hub prepends one dispatcher directory and one git configuration. Each dispatcher
 * shim picks the project whose state or ticket directory contains the current working directory and runs that project's own
 * shim (its `gh` account wrapper, its `lark-cli` bot, or its blocked-command stub); outside every project it runs the next
 * command of that name on PATH. The git credential helper calls the dispatcher `gh`, so a worker's git authenticates as the
 * account of the project its ticket directory belongs to.
 */
import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { agentVariables, applyEnvironment, excludeHubDirectory, withoutDirectory, workerBin } from '../infra/environment.ts'

const MARKER = '# Written by dsh-multi-superagent hub; edits are lost.'
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`
const gitQuote = (value: string): string => `"${value.replace(/[\\"]/g, char => `\\${char}`)}"`
const real = (path: string): string => { try { return realpathSync(path) } catch { return resolve(path) } }
const BASE_COMMANDS = ['gh', 'lark-cli']

export interface HubEntry { stateDir: string; workRoot: string; blocked: readonly string[] }

/** Owns the shared dispatcher shims and git configuration of every running Multi-SA project. */
export class Hub {
  readonly bin: string
  readonly gitconfig: string
  private readonly entries = new Map<string, HubEntry>()
  private writing: Promise<void> = Promise.resolve()
  private restore?: () => void
  private unexclude?: () => void
  constructor(readonly root: string) {
    this.bin = workerBin(join(root, 'hub'))
    this.gitconfig = join(root, 'hub', 'gitconfig')
  }
  /** Writes the dispatcher shims and git configuration, then points `process.env` at them. */
  async start(): Promise<void> {
    this.unexclude = excludeHubDirectory(this.bin)
    await this.write()
    const path = withoutDirectory(process.env.PATH ?? '', this.bin)
    this.restore = applyEnvironment({ ...agentVariables(join(this.root, 'hub')), GIT_CONFIG_GLOBAL: this.gitconfig }, join(this.root, 'hub'), path)
  }
  stop(): void { this.restore?.(); this.restore = undefined; this.unexclude?.(); this.unexclude = undefined }
  update(id: string, entry: HubEntry): Promise<void> { this.entries.set(id, entry); return this.write() }
  remove(id: string): Promise<void> { if (!this.entries.delete(id)) return this.writing; return this.write() }
  /** Serializes rewrites so concurrent project starts never interleave temporary files. */
  private write(): Promise<void> {
    this.writing = this.writing.catch(() => {}).then(() => this.writeNow())
    return this.writing
  }
  private async writeNow(): Promise<void> {
    await mkdir(this.bin, { recursive: true, mode: 0o700 })
    // Longest directory first, so a project whose ticket directory lies inside another project's directory still wins.
    const roots = [...this.entries].flatMap(([id, entry]) => {
      const dirs = new Set([entry.stateDir, entry.workRoot].flatMap(dir => [resolve(dir), real(dir)]))
      return [...dirs].map(dir => ({ id, dir, bin: workerBin(entry.stateDir) }))
    }).sort((a, b) => b.dir.length - a.dir.length)
    const names = new Set([...BASE_COMMANDS, ...[...this.entries.values()].flatMap(entry => entry.blocked)])
    names.delete('git')
    const withoutSelf = [
      `self=${shellQuote(this.bin)}`, 'rest=', 'IFS=:', 'set -f',
      'for entry in $PATH; do [ "$entry" = "$self" ] || rest="${rest:+$rest:}$entry"; done',
      'set +f', 'unset IFS', 'PATH=$rest', 'export PATH',
    ].join('\n')
    const kept = new Set<string>()
    for (const name of names) {
      if (!/^[A-Za-z0-9._+-]+$/.test(name)) continue
      const cases = roots.map(({ dir, bin }) => {
        const target = shellQuote(join(bin, name))
        return `  ${shellQuote(`${dir}/`)}*) if [ -x ${target} ]; then exec ${target} "$@"; fi ;;`
      })
      const body = [withoutSelf, 'here=$(pwd -P 2>/dev/null || pwd)', ...cases.length ? ['case "$here/" in', ...cases, 'esac'] : [],
        `exec ${shellQuote(name)} "$@"`].join('\n')
      const temporary = join(this.bin, `.${name}.${process.pid}.tmp`)
      await writeFile(temporary, `#!/bin/sh\n${MARKER}\n${body}\n`, { mode: 0o755 })
      await rename(temporary, join(this.bin, name))
      kept.add(name)
    }
    for (const name of await readdir(this.bin)) if (!kept.has(name) && !name.startsWith('.')) await unlink(join(this.bin, name)).catch(() => {})
    const config = [
      MARKER,
      '[user]', '\tuseConfigOnly = true',
      '[credential]', '\thelper =',
      '[credential "https://github.com"]', `\thelper = ${gitQuote(`!${shellQuote(join(this.bin, 'gh'))} auth git-credential`)}`,
      '[url "https://github.com/"]', '\tinsteadOf = git@github.com:', '\tinsteadOf = ssh://git@github.com/',
      '[filter "lfs"]', '\tclean = git-lfs clean -- %f', '\tsmudge = git-lfs smudge -- %f', '\tprocess = git-lfs filter-process', '\trequired = true',
    ].join('\n') + '\n'
    const temporary = `${this.gitconfig}.${process.pid}.tmp`
    await writeFile(temporary, config, { mode: 0o644 })
    await rename(temporary, this.gitconfig)
  }
}
