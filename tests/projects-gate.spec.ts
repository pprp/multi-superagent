import { describe, expect, it } from 'vitest'
import { projectGate } from '../src/client/projects.tsx'

const view = (id: string, enabled = true) => ({ id, enabled }) as never

describe('projectGate', () => {
  it('waits for the project list', () => { expect(projectGate(undefined, 'a')).toBe('unknown') })
  it('reports a removed or unknown project', () => { expect(projectGate({ root: '/r', projects: [view('b')] }, 'a')).toBe('missing') })
  it('reports a disabled project instead of opening its unmounted routes', () => {
    expect(projectGate({ root: '/r', projects: [view('a', false)] }, 'a')).toBe('stopped')
  })
  it('opens an enabled project', () => { expect(projectGate({ root: '/r', projects: [view('a')] }, 'a')).toBe('open') })
})
