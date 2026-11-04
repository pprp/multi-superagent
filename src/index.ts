/** Multi-SA main plugin entry: runs one Superagent Runtime per project and serves the project list API. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { Config, machineOf, type DeploymentConfig } from './deployment.ts'
import { ProjectManager, registerProjectsHttp } from './multi/projects.ts'

export const name = 'dsh-multi-superagent'
export const inject = ['agents', 'sessionController', 'sessionPersistence', 'workspaceRegistry', 'permissionPresets', 'tools', 'systemPrompt', 'skills', 'webServer', 'llm', 'subprocess']
export { Config }
export async function apply(ctx: Context, config: DeploymentConfig): Promise<void> {
  const machine = machineOf(config)
  ctx.inject(['settings'], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  if (ctx.webServer.host !== '127.0.0.1') throw new Error('Multi-SA management requires a loopback Web server')
  const manager = new ProjectManager(ctx, machine.stateDir, machine)
  ctx.effect(() => registerProjectsHttp(ctx, manager))
  ctx.effect(() => async () => { await manager.stop() })
  await manager.start()
  ctx.logger.info('Multi-SA ready with %d project(s); the Multi-SA sidebar entry opens the management panel', manager.list().length)
}
export type { Deployment, DeploymentConfig } from './deployment.ts'
export * from './core/index.ts'
