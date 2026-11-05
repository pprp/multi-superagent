/** Browser plugin entry point registering the sidebar icon, main management panel, and Plugin Manager config view. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { openKnownSession, SessionNavigationError } from '../navigation.ts'
import { App } from './app.tsx'
import { ProjectBar, ProjectsHome, projectGate, useProjects } from './projects.tsx'
import { routeScope } from './route.ts'
import { PluginConfig, usePageForm } from './deployment.tsx'
import { en, zh } from './locales.ts'
import type { T } from './text.ts'

type ClientContext = Context & { sessions: ISessions }
const NS = 'dshMultiSuperagent'
const PANEL_ID = 'dsh-multi-superagent' as MainPanelId
const ENTRY = 'dsh-multi-superagent'
const PROJECT_KEY = 'dsh-multi-superagent/project'

function StackIcon({ size }: SidebarPanelIconOwnerProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="4" width="11" height="8" rx="2" /><rect x="7" y="8" width="11" height="8" rx="2" /><rect x="10" y="12" width="11" height="8" rx="2" />
  </svg>
}
const stored = (): string | undefined => { try { return sessionStorage.getItem(PROJECT_KEY) ?? undefined } catch { return undefined } }

/** Mounted panel wrapper; cancels any pending Session navigation when a new one starts or the panel unmounts. */
function Mounted({ ctx, t }: { ctx: ClientContext; t: T }) {
  const pending = useRef<AbortController>(undefined)
  useEffect(() => () => { pending.current?.abort() }, [])
  const openSession = useCallback(async (id: string) => {
    pending.current?.abort()
    const request = new AbortController(); pending.current = request
    try {
      await openKnownSession(ctx.sessions, id as SessionId, target => { ctx.uiWorkspace.openSession(target) }, request.signal)
    } catch (error) {
      if (error instanceof SessionNavigationError) throw new Error(t(error.code === 'not-ready' ? 'sessionListNotReady' : 'sessionNotListed'))
      throw error
    }
  }, [ctx, t])
  const form = usePageForm(ctx.get('configForms')?.get<Record<string, unknown>>(ENTRY))
  const [project, setProject] = useState<string | undefined>(stored)
  const [notice, setNotice] = useState<string>()
  const projects = useProjects()
  // The list may predate the selection (a project just created, or a stale id restored from sessionStorage),
  // so the gate only trusts a list fetched after the current project was selected.
  const [fresh, setFresh] = useState<string>()
  const { reload } = projects
  useEffect(() => {
    if (!project) return
    let live = true
    void reload().then(() => { if (live) setFresh(project) })
    return () => { live = false }
  }, [project, reload])
  const select = useCallback((id: string | undefined) => {
    try { if (id) sessionStorage.setItem(PROJECT_KEY, id); else sessionStorage.removeItem(PROJECT_KEY) } catch { /* Storage may be unavailable. */ }
    setNotice(undefined); setProject(id)
  }, [])
  const gate = project && fresh === project && !projects.error ? projectGate(projects.data, project) : 'unknown'
  useEffect(() => {
    if (project && gate === 'missing') { select(undefined); setNotice(t('msa.projectGone', { id: project })) }
  }, [project, gate, select, t])
  if (!project || gate === 'missing') return <ProjectsHome t={t} onOpen={select} notice={notice} />
  const bar = <ProjectBar t={t} current={project} onSelect={select} />
  if (gate === 'stopped') return <ProjectStopped t={t} bar={bar} />
  routeScope(project)
  return <App key={project} t={t} openSession={openSession} deploymentForm={form} base={`/multi-sa/p/${encodeURIComponent(project)}/api/`}
    projectBar={bar} />
}

/** Shown instead of the project panel while the project is disabled, so its unmounted routes are not reported as an unresponsive host. */
function ProjectStopped({ t, bar }: { t: T; bar: ReactNode }) {
  return <div className="dt-page"><div className="dt-column">
    <header className="dt-head"><div className="dt-head-title"><h1 className="dt-title">{t('title')}</h1></div><div className="dt-toolbar">{bar}</div></header>
    <p className="dt-hint" role="status">{t('msa.projectStopped')}</p>
  </div></div>
}

export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace']
/** Registers the panel, sidebar icon, and Plugin Manager config view; `configForms` is optional (without it, machine settings are read-only). */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-multi-superagent: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({}) },
    (props: { t: T }) => <Mounted ctx={ctx} t={props.t} />))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 11, label: () => t('panel'), locale: NS }, StackIcon))
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({ name: 'plugins.row.config', key: `${ENTRY}#${ENTRY}`, locale: NS },
    (props: PluginConfigViewProps & { t: T }) => <PluginConfig t={props.t} view={props.view} form={props.form} />))
}
