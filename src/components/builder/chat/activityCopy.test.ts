import { describe, expect, it } from 'vitest'
import { getToolCallDetail, getToolCallHeadline, getToolCallLabel } from './activityCopy'
import type { ToolCall } from './types'

function makeToolCall(name: ToolCall['name'], args: ToolCall['args'] = {}): ToolCall {
  return {
    id: 'tool-1',
    name,
    args,
    status: 'running',
  }
}

describe('activityCopy', () => {
  it('describes file creation in plain language', () => {
    const toolCall = makeToolCall('createFile', { path: 'src/app/page.tsx' })

    expect(getToolCallLabel(toolCall)).toBe('Creating page.tsx')
    expect(getToolCallHeadline(toolCall)).toBe('🧱 Creating page.tsx')
  })

  it('describes code reading as project context work', () => {
    const toolCall = makeToolCall('readFile', { path: 'src/components/Header.tsx' })

    expect(getToolCallLabel(toolCall)).toBe('Reading Header.tsx')
    expect(getToolCallDetail(toolCall)).toContain('reading what is already in the project')
  })

  it('truncates long shell commands for live activity copy', () => {
    const toolCall = makeToolCall('runCommand', {
      command: 'pnpm exec playwright test --project=webkit --grep "builder session smoke test"',
    })

    expect(getToolCallLabel(toolCall)).toContain('Running pnpm exec playwright test')
    expect(getToolCallHeadline(toolCall)).toContain('💻')
  })
})
