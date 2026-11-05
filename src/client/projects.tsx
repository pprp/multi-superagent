/** Multi-SA first page: the project list with creation, enabling, restarting and removal, and the header project switcher. */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Dot, Icon, Input, Modal, type DotState } from './controls.tsx'
import { REPOSITORY } from '../limits.ts'
import STYLES from './client.css?raw'
import type { T } from './text.ts'

export interface ProjectView {
  id: string; name: string; description: string; repository: string; feishu: boolean; enabled: boolean; createdAt: string
  stateDir: string; status: 'stopped' | 'starting' | 'ready' | 'setup' | 'error'; detail: string
  running: number; open: number; person: number; paused: boolean; account: string; feishuBot: string; masterId: string
}
interface ProjectsView { root: string; projects: ProjectView[] }

async function request<R>(path: string, method = 'GET', body?: unknown): Promise<R> {
  const response = await fetch(`/multi-sa/api/${path}`, { method, headers: { 'x-multi-sa-request': '1',
    ...body === undefined ? {} : { 'content-type': 'application/json' } }, ...body === undefined ? {} : { body: JSON.stringify(body) } })
  const value = await response.json().catch(() => ({})) as R & { error?: string }
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`)
  return value
}

export function useProjects() {
  const [data, setData] = useState<ProjectsView>()
  const [error, setError] = useState<Error>()
  const reload = useCallback(async () => {
    try { setData(await request<ProjectsView>('projects')); setError(undefined) }
    catch (failure) { setError(failure instanceof Error ? failure : new Error(String(failure))) }
  }, [])
  useEffect(() => {
    void reload()
    const timer = setInterval(() => { if (!document.hidden) void reload() }, 5000)
    return () => clearInterval(timer)
  }, [reload])
  return { data, error, reload }
}

const DOT: Record<ProjectView['status'], DotState> = { ready: 'done', setup: 'warning', starting: 'ongoing', stopped: 'idle', error: 'error' }

/** Whether a selected project can show its panel: `missing` once a fresh list lacks it, `stopped` while it is disabled (its routes are unmounted). */
export function projectGate(data: ProjectsView | undefined, id: string): 'unknown' | 'missing' | 'stopped' | 'open' {
  if (!data) return 'unknown'
  const project = data.projects.find(item => item.id === id)
  return !project ? 'missing' : !project.enabled ? 'stopped' : 'open'
}

function CreateProject({ t, open, onClose, onCreated }: { t: T; open: boolean; onClose: () => void; onCreated: (project: ProjectView) => void }) {
  const empty = { name: '', id: '', repository: '', githubCli: '', feishu: false, feishuCli: '', description: '' }
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setForm(empty); setError('') } }, [open])
  const field = (key: keyof typeof empty, label: string, hint?: string, placeholder?: string) => <label className="dt-field">
    <span className="dt-field-head">{label}</span>
    <Input value={String(form[key])} placeholder={placeholder} onChange={event => setForm({ ...form, [key]: event.target.value })} />
    {hint && <span className="dt-hint">{hint}</span>}
  </label>
  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!REPOSITORY.test(form.repository.trim())) { setError(t('msa.repositoryInvalid')); return }
    setBusy(true); setError('')
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, value]) => value !== ''))
      onCreated(await request<ProjectView>('projects', 'POST', body))
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <Modal open={open} onClose={onClose} title={t('msa.new')} closeLabel={t('close')} description={t('msa.homeIntro')}
    footer={<>
      {error && <p className="dt-error" role="alert" style={{ marginRight: 'auto' }}>{error}</p>}
      <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
      <Button variant="primary" disabled={busy || !form.name.trim()} onClick={() => { void submit() }}>{t('msa.create')}</Button>
    </>}>
    <form className="dt-form msa-create" onSubmit={event => { void submit(event) }}>
      {field('name', t('msa.name'), undefined, 'my-service')}
      {field('id', t('msa.id'), t('msa.idHint'))}
      {field('repository', t('msa.repository'), t('msa.repositoryHint'), 'owner/name')}
      {field('githubCli', t('msa.githubCli'), t('msa.githubCliHint'), 'gh-agent')}
      <label className="msa-check"><input type="checkbox" checked={form.feishu} onChange={event => setForm({ ...form, feishu: event.target.checked })} />
        {t('msa.feishu')}</label>
      {form.feishu && field('feishuCli', t('msa.feishuCli'), undefined, 'lark-cli')}
      {field('description', t('msa.description'))}
      <button type="submit" hidden />
    </form>
  </Modal>
}

function ProjectCard({ t, project, onOpen, onChanged }: { t: T; project: ProjectView; onOpen: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')
  const act = async (path: string, method: string, body?: unknown) => {
    setBusy(true); setError('')
    try { await request(path, method, body); onChanged() }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const stat = (label: string, value: ReactNode) => <span className="dt-stat"><span className="dt-stat-label">{label}</span>
    <span className="dt-stat-value">{value}</span></span>
  return <li className="dt-card msa-card">
    <div className="dt-card-head">
      <Dot state={DOT[project.status]} label={t(`msa.status.${project.status}`)} />
      <div className="dt-row-main">
        <button type="button" className="dt-textlink msa-card-title" disabled={!project.enabled} onClick={onOpen}>{project.name}</button>
        <span className="dt-hint msa-card-sub">{project.repository || '—'}{project.feishu ? ' · Feishu' : ''} · {t(`msa.status.${project.status}`)}
          {project.paused ? ` · ${t('msa.paused')}` : ''}</span>
      </div>
      <div className="msa-card-actions">
        {project.enabled && <Button variant="primary" size="sm" onClick={onOpen}>{t('msa.open')}</Button>}
        {project.enabled && <Button variant="ghost" size="sm" icon={<Icon name="refresh" size={14} />} disabled={busy}
          onClick={() => { void act(`projects/${project.id}/restart`, 'POST') }}>{t('msa.restart')}</Button>}
        <Button variant="ghost" size="sm" icon={<Icon name={project.enabled ? 'pause' : 'play'} size={14} />} disabled={busy}
          onClick={() => { void act(`projects/${project.id}`, 'PATCH', { enabled: !project.enabled }) }}>{t(project.enabled ? 'msa.disable' : 'msa.enable')}</Button>
        <Button variant="ghost" size="sm" icon={<Icon name="trash" size={14} />} disabled={busy} onClick={() => setRemoving(true)}>{t('msa.remove')}</Button>
      </div>
    </div>
    {project.description && <p className="dt-hint">{project.description}</p>}
    {project.enabled && project.status !== 'starting' && <div className="dt-stats">
      {stat(t('msa.person.count'), project.person)}
      {stat(t('msa.open.count'), project.open)}
      {stat(t('msa.running.count'), project.running)}
      {stat(t('msa.account'), project.account ? `@${project.account}` : '—')}
    </div>}
    {project.detail && project.status !== 'ready' && <p className={project.status === 'error' ? 'dt-error' : 'dt-hint'}>{project.detail}</p>}
    <span className="dt-hint">{t('msa.stateDir')} <span className="dt-mono">{project.stateDir}</span></span>
    {error && <p className="dt-error" role="alert">{error}</p>}
    <Modal open={removing} onClose={() => setRemoving(false)} title={`${t('msa.removeTitle')} · ${project.name}`} closeLabel={t('close')}
      description={t('msa.removeMessage')} footer={<>
        <Button variant="ghost" onClick={() => setRemoving(false)}>{t('cancel')}</Button>
        <Button variant="primary" disabled={busy} onClick={() => { setRemoving(false); void act(`projects/${project.id}?purge=1`, 'DELETE') }}>{t('confirm')}</Button>
      </>} />
  </li>
}

/** The first page of Multi-SA: every project with its status, and a form to add one. */
export function ProjectsHome({ t, onOpen, notice }: { t: T; onOpen: (id: string) => void; notice?: string }) {
  const { data, error, reload } = useProjects()
  const [creating, setCreating] = useState(false)
  return <div className="dt-page">
    <style>{STYLES}</style>
    <div className="dt-column">
      <header className="dt-head">
        <div className="dt-head-title"><h1 className="dt-title">{t('title')}</h1></div>
        <div className="dt-toolbar">
          <Button variant="primary" size="sm" icon={<Icon name="plus" size={14} />} onClick={() => setCreating(true)}>{t('msa.new')}</Button>
        </div>
      </header>
      <p className="dt-hint">{t('msa.homeIntro')}</p>
      {notice && <p className="dt-hint" role="status">{notice}</p>}
      {error && <p className="dt-error" role="alert">{error.message}</p>}
      <section className="dt-section">
        <h2 className="dt-section-title">{t('msa.projects')}{data && <span className="dt-count"> {data.projects.length}</span>}</h2>
        {!data ? <p className="dt-hint">{t('loading')}</p> : data.projects.length === 0 ? <p className="dt-hint">{t('msa.none')}</p>
          : <ul className="dt-list dt-cards msa-cards">{data.projects.map(project => <ProjectCard key={project.id} t={t} project={project}
            onOpen={() => onOpen(project.id)} onChanged={() => { void reload() }} />)}</ul>}
        {data && <p className="dt-hint">{t('msa.root')} <span className="dt-mono">{data.root}</span></p>}
      </section>
    </div>
    <CreateProject t={t} open={creating} onClose={() => setCreating(false)} onCreated={project => { setCreating(false); void reload(); onOpen(project.id) }} />
  </div>
}

/** Header switcher inside a project: back to every project, or jump to another one. */
export function ProjectBar({ t, current, onSelect }: { t: T; current: string; onSelect: (id: string | undefined) => void }) {
  const { data } = useProjects()
  const known = data?.projects.some(project => project.id === current) ?? false
  return <span className="msa-bar">
    <Button variant="ghost" size="sm" icon={<Icon name="queue" size={14} />} onClick={() => onSelect(undefined)}>{t('msa.allProjects')}</Button>
    <select className="msa-select" aria-label={t('msa.switch')} value={current} onChange={event => onSelect(event.target.value)}>
      {(data?.projects ?? []).filter(project => project.enabled || project.id === current).map(project =>
        <option key={project.id} value={project.id}>{project.name}{project.repository ? ` (${project.repository})` : ''}</option>)}
      {!known && <option value={current}>{data ? t('msa.missingOption', { id: current }) : current}</option>}
    </select>
  </span>
}
