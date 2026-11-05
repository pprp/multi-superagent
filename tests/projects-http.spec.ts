import { expect, it } from 'vitest'
import { REPOSITORY } from '../src/limits.ts'
import { registerProjectsHttp, type ProjectManager } from '../src/multi/projects.ts'

type Handler = (req: unknown, res: unknown) => Promise<void>
type Headers = Record<string, string | undefined>
/** Mount the project list API on a fake web server with a fake connection fence and return a request helper. */
function serve(connection: unknown = { requestRejection: (req: { headers: Headers }) => req.headers.cookie === 'dsh-auth-test=ok' ? undefined : 401 }) {
  let handler: Handler = async () => {}
  const created: unknown[] = []
  const manager = { rootDir: '/state', list: () => [], create: async (body: unknown) => { created.push(body); return { id: 'p' } } }
  const ctx = { connection, webServer: { host: '127.0.0.1', port: 3082, register: (route: { handler: Handler }) => { handler = route.handler; return () => {} } } }
  registerProjectsHttp(ctx as never, manager as unknown as ProjectManager)
  const call = async (method: string, path: string, body?: string, headers: Headers = {}) => {
    let status = 0, text = ''
    const sent = Object.fromEntries(Object.entries({ host: '127.0.0.1:3082', 'x-multi-sa-request': '1', cookie: 'dsh-auth-test=ok', ...headers })
      .filter(([, value]) => value !== undefined))
    const chunks = body === undefined ? [] : [Buffer.from(body)]
    const req = { method, url: `/multi-sa/api/${path}`, headers: sent, async *[Symbol.asyncIterator]() { yield* chunks } }
    await handler(req, { writeHead: (code: number) => { status = code }, end: (data: string) => { text = data } })
    return { status, body: JSON.parse(text) as Record<string, unknown> }
  }
  return { call, created }
}

it('serves the project list only to an authenticated same-origin dsh web session', async () => {
  const { call, created } = serve()
  expect(await call('GET', 'projects')).toEqual({ status: 200, body: { root: '/state', projects: [] } })
  expect(await call('GET', 'projects', undefined, { cookie: undefined })).toEqual({ status: 401, body: { error: 'dsh web authentication required' } })
  expect(await call('POST', 'projects', '{"name":"x"}', { cookie: undefined })).toMatchObject({ status: 401 })
  expect(await call('GET', 'projects', undefined, { 'x-multi-sa-request': undefined })).toMatchObject({ status: 403 })
  expect(created).toEqual([])
  // Without a connection service the API fails closed.
  expect(await serve(null).call('GET', 'projects')).toMatchObject({ status: 401 })
})

it('answers a body that is empty or not JSON with 400', async () => {
  const { call, created } = serve()
  expect(await call('POST', 'projects', '{not json')).toEqual({ status: 400, body: { error: 'The request body is not JSON' } })
  expect(await call('POST', 'projects', '')).toMatchObject({ status: 400 })
  expect(await call('PATCH', 'projects/p', 'x')).toMatchObject({ status: 400 })
  expect(created).toEqual([])
})

it('accepts owner/name repositories and refuses dot segments', () => {
  for (const value of ['', 'octocat/hello-world', 'Org.Name/repo_1', 'owner/.github', 'owner/a..b', 'o/..x'])
    expect(REPOSITORY.test(value), value).toBe(true)
  for (const value of ['../..', './repo', 'owner/..', 'owner/.', '../repo', 'noslash', 'a/b/c', 'own er/repo'])
    expect(REPOSITORY.test(value), value).toBe(false)
})
