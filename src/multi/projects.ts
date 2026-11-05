/**
 * Multi-SA project manager. One DSH process runs one Superagent Runtime per project: each project lives in its own isolated
 * `orchestrator` service scope with its own state directory (database, lock, shims), its own GitHub repository and account, its
 * optional Feishu bot, and its own management API under `/multi-sa/p/<id>/api/`. The project list is the JSON file
 * `<rootDir>/projects.json`; `/multi-sa/api/projects` lists, creates, updates and removes projects.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { z } from 'zod'
import { Runtime } from '../app/runtime.ts'
import { Store } from '../app/store.ts'
import { RouteError, json, readBody, rejectManagement } from '../app/http.ts'
import type { Machine, ProjectBinding } from '../deployment.ts'
import * as github from '../sources/github.ts'
import * as feishu from '../sources/feishu.ts'
import { Hub } from './hub.ts'
import { ticketStage } from '../core/index.ts'

import { REPOSITORY } from '../limits.ts'

export const ProjectSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(400).default(''),
  /** GitHub repository `owner/name`, seeded into the project's GitHub Source on creation. */
  repository: z.string().trim().regex(REPOSITORY).default(''),
  feishu: z.boolean().default(false),
  enabled: z.boolean().default(true),
  createdAt: z.string(),
  /** Absolute state directory; defaults to `<rootDir>/projects/<id>`. */
  stateDir: z.string().optional(),
})
export type Project = z.infer<typeof ProjectSchema>
const ProjectsFile = z.object({ version: z.literal(1), projects: z.array(ProjectSchema) })
const CreateRequest = z.object({
  name: z.string().trim().min(1).max(80),
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).optional(),
  description: z.string().max(400).optional(),
  repository: z.string().trim().regex(REPOSITORY, 'owner/name').optional(),
  githubCli: z.string().trim().max(400).optional(),
  feishu: z.boolean().optional(),
  feishuCli: z.string().trim().max(400).optional(),
  stateDir: z.string().trim().regex(/^\//, 'absolute path').optional(),
})
const UpdateRequest = z.object({ name: z.string().trim().min(1).max(80).optional(), description: z.string().max(400).optional(),
  enabled: z.boolean().optional(), feishu: z.boolean().optional() })

export interface Limits { promptMaxChars: Machine['promptMaxChars']; admissionContextMaxPages: Machine['admissionContextMaxPages']; admissionContextTimeoutMs: Machine['admissionContextTimeoutMs'] }

interface Mounted { fiber: Fiber; runtime?: Runtime; error?: string; starting: boolean }

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)

/** Keeps the project list file and one isolated Runtime per enabled project. */
export class ProjectManager {
  readonly hub: Hub
  private projects: Project[] = []
  private readonly mounted = new Map<string, Mounted>()
  private readonly file: string
  private saving: Promise<void> = Promise.resolve()
  constructor(private readonly ctx: Context, readonly rootDir: string, private readonly limits: Limits) {
    mkdirSync(rootDir, { recursive: true, mode: 0o700 })
    this.file = join(rootDir, 'projects.json')
    this.hub = new Hub(rootDir)
    if (existsSync(this.file)) this.projects = ProjectsFile.parse(JSON.parse(readFileSync(this.file, 'utf8'))).projects
  }
  stateDir(project: Project): string { return project.stateDir ?? join(this.rootDir, 'projects', project.id) }
  async start(): Promise<void> {
    await this.hub.start()
    for (const project of this.projects) if (project.enabled) this.mount(project)
  }
  async stop(): Promise<void> {
    await Promise.allSettled([...this.mounted.keys()].map(id => this.unmount(id)))
    this.hub.stop()
  }
  list() {
    return this.projects.map(project => {
      const mounted = this.mounted.get(project.id)
      const runtime = mounted?.runtime
      let status: 'stopped' | 'starting' | 'ready' | 'setup' | 'error' = 'stopped'
      let detail = mounted?.error ?? ''
      let running = 0, open = 0, person = 0, paused = false, account = '', feishuBot = ''
      if (mounted?.starting) status = 'starting'
      else if (mounted?.error) status = 'error'
      else if (runtime) {
        try {
          status = runtime.configured() ? 'ready' : 'setup'
          detail = runtime.setupProblem?.detail ?? ''
          const settings = runtime.store.settings()
          paused = settings.paused
          running = runtime.executor.activeCount()
          const tickets = runtime.store.tickets.open()
          open = tickets.length
          person = tickets.filter(ticket => ticketStage(ticket).stage === 'person').length
          if (runtime.configured()) { account = runtime.deployment.github.login; feishuBot = runtime.deployment.feishu?.name ?? '' }
        } catch (error) { status = 'error'; detail = error instanceof Error ? error.message : String(error) }
      }
      return { ...project, stateDir: this.stateDir(project), status, detail, running, open, person, paused, account, feishuBot,
        masterId: runtime?.masterId ?? '' }
    })
  }
  async create(input: unknown) {
    const request = CreateRequest.parse(input)
    let id = request.id || slug(request.name) || `p-${randomBytes(3).toString('hex')}`
    if (!/^[a-z0-9]/.test(id)) id = `p-${id}`
    if (this.projects.some(project => project.id === id)) {
      if (request.id) throw new ProjectError(409, `Project id ${id} is taken`)
      id = `${id.slice(0, 32)}-${randomBytes(2).toString('hex')}`
    }
    if (request.repository && this.projects.some(project => project.repository.toLowerCase() === request.repository!.toLowerCase())) {
      throw new ProjectError(409, `Repository ${request.repository} already belongs to another project`)
    }
    const project = ProjectSchema.parse({ id, name: request.name, description: request.description ?? '', repository: request.repository ?? '',
      feishu: request.feishu ?? false, enabled: true, createdAt: new Date().toISOString(), ...request.stateDir ? { stateDir: request.stateDir } : {} })
    this.projects = [...this.projects, project]
    await this.save()
    // Seed the Sources before the Runtime's first start so setup resolves accounts right away.
    await this.seed(project, request.githubCli ?? '', request.feishuCli ?? '')
    this.mount(project)
    return this.list().find(item => item.id === id)!
  }
  async update(id: string, input: unknown) {
    const request = UpdateRequest.parse(input)
    const project = this.get(id)
    const next = { ...project, ...Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined)) } as Project
    this.projects = this.projects.map(item => item.id === id ? next : item)
    await this.save()
    const remount = next.enabled !== project.enabled || next.feishu !== project.feishu
    if (remount) { await this.unmount(id); if (next.enabled) this.mount(next) }
    return this.list().find(item => item.id === id)!
  }
  async remove(id: string, purge: boolean) {
    const project = this.get(id)
    await this.unmount(id)
    this.projects = this.projects.filter(item => item.id !== id)
    await this.save()
    if (purge && !project.stateDir) await rm(this.stateDir(project), { recursive: true, force: true })
    return { removed: true }
  }
  async restart(id: string) { const project = this.get(id); await this.unmount(id); if (project.enabled) this.mount(project); return { restarted: true } }
  private get(id: string): Project {
    const project = this.projects.find(item => item.id === id)
    if (!project) throw new ProjectError(404, 'Project not found')
    return project
  }
  private save(): Promise<void> {
    const text = JSON.stringify({ version: 1, projects: this.projects }, null, 2) + '\n'
    this.saving = this.saving.catch(() => {}).then(async () => {
      const temporary = `${this.file}.${process.pid}.tmp`
      await writeFile(temporary, text, { mode: 0o600 })
      await rename(temporary, this.file)
    })
    return this.saving
  }
  /** Writes the initial GitHub and Feishu Source settings straight into a new project's database. */
  private async seed(project: Project, githubCli: string, feishuCli: string): Promise<void> {
    if (!project.repository && !githubCli && !feishuCli) return
    const stateDir = this.stateDir(project)
    mkdirSync(stateDir, { recursive: true, mode: 0o700 })
    const store = new Store(join(stateDir, 'orchestrator.sqlite'), error => { this.ctx.logger.warn('multi-sa seed: %s', String(error)) })
    try {
      const settings = store.settings()
      const sources = { ...settings.sources }
      sources.github = { enabled: true, config: { ...sources.github?.config, repository: project.repository, cli: githubCli } }
      if (feishuCli) sources.feishu = { enabled: true, config: { ...sources.feishu?.config, cli: feishuCli } }
      store.saveSettings({ ...settings, sources })
    } finally { store.close() }
  }
  private mount(project: Project): void {
    const manager = this
    const binding: ProjectBinding = { id: project.id, name: project.name, httpBase: `/multi-sa/p/${project.id}`,
      hub: { update: (id, entry) => this.hub.update(id, entry), remove: id => this.hub.remove(id) } }
    const { promptMaxChars, admissionContextMaxPages, admissionContextTimeoutMs } = this.limits
    const machine: Machine = { stateDir: this.stateDir(project), project: binding, promptMaxChars, admissionContextMaxPages, admissionContextTimeoutMs }
    const state: Mounted = { fiber: undefined as unknown as Fiber, starting: true }
    const scope = this.ctx.isolate('orchestrator')
    const plugin = {
      name: `multi-sa:${project.id}`,
      inject: ['agents', 'sessionController', 'sessionPersistence', 'workspaceRegistry', 'permissionPresets', 'tools', 'systemPrompt', 'skills', 'webServer', 'connection', 'llm', 'subprocess'],
      async apply(ctx: Context) {
        const restart = (): void => {
          void manager.restart(project.id).catch((error: unknown) => { ctx.logger.error('Multi-SA project %s restart failed: %s', project.id, String(error)) })
        }
        state.starting = true; state.error = undefined
        try {
          const runtime = new Runtime(ctx, machine, restart)
          state.runtime = runtime
          ctx.effect(() => async () => { state.runtime = undefined; await runtime.stop() })
          ctx.plugin(github)
          if (project.feishu) ctx.plugin(feishu)
          await runtime.ready
          ctx.logger.info('Multi-SA project %s %s', project.id, runtime.configured() ? 'ready' : `waiting for setup: ${runtime.setupProblem?.detail ?? ''}`)
        } catch (error) {
          state.error = error instanceof Error ? error.message : String(error)
          throw error
        } finally { state.starting = false }
      },
    }
    state.fiber = scope.plugin(plugin as never, undefined as never)
    this.mounted.set(project.id, state)
    Promise.resolve(state.fiber).catch((error: unknown) => {
      state.starting = false
      state.error = error instanceof Error ? error.message : String(error)
    })
  }
  private async unmount(id: string): Promise<void> {
    const state = this.mounted.get(id)
    if (!state) return
    this.mounted.delete(id)
    await state.fiber.dispose()
  }
}

/** A project API failure with its HTTP status. */
export class ProjectError extends Error { constructor(readonly status: number, message: string) { super(message) } }

/** Registers `/multi-sa/api/*`: the project list and its management. */
export function registerProjectsHttp(ctx: Context, manager: ProjectManager): () => void {
  return ctx.webServer.register({ kind: 'prefix', path: '/multi-sa/api', handler: async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (rejectManagement(ctx, req, res)) return
    const parts = url.pathname.slice('/multi-sa/api/'.length).split('/').filter(Boolean).map(decodeURIComponent)
    const method = req.method ?? 'GET'
    try {
      if (parts[0] !== 'projects') throw new ProjectError(404, 'Unknown operation')
      const id = parts[1]
      if (!id && method === 'GET') { json(res, 200, { root: manager.rootDir, projects: manager.list() }); return }
      if (!id && method === 'POST') { json(res, 200, await manager.create(await readBody(req))); return }
      if (id && !parts[2] && method === 'PATCH') { json(res, 200, await manager.update(id, await readBody(req))); return }
      if (id && !parts[2] && method === 'DELETE') { json(res, 200, await manager.remove(id, url.searchParams.get('purge') === '1')); return }
      if (id && parts[2] === 'restart' && method === 'POST') { json(res, 200, await manager.restart(id)); return }
      throw new ProjectError(404, 'Unknown operation')
    } catch (error) {
      if (error instanceof z.ZodError) { json(res, 400, { error: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') }); return }
      if (error instanceof ProjectError) { json(res, error.status, { error: error.message }); return }
      if (error instanceof RouteError) { json(res, error.status, { error: error.message }); return }
      json(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  } })
}
