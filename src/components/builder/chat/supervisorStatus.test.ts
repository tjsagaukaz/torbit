import { describe, expect, it } from 'vitest'
import { getInlineSupervisorStatus } from './supervisorStatus'
import type { SupervisorEvent } from '@/lib/supervisor/events'

function makeEvent(event: SupervisorEvent['event'], stage: string, success = true): SupervisorEvent {
  return {
    event,
    timestamp: new Date().toISOString(),
    run_id: 'run-1',
    stage,
    summary: 'test',
    details: { success },
  }
}

describe('getInlineSupervisorStatus', () => {
  it('maps early build phases to plain language', () => {
    expect(getInlineSupervisorStatus(makeEvent('run_started', 'run'))).toBe('Starting your build.')
    expect(getInlineSupervisorStatus(makeEvent('route_selected', 'routing'))).toBe('Planning the build.')
    expect(getInlineSupervisorStatus(makeEvent('gate_started', 'vibe_audit'))).toBe('Checking the project before building.')
    expect(getInlineSupervisorStatus(makeEvent('gate_started', 'execution'))).toBe('Starting file changes.')
  })

  it('maps fallback and failure events', () => {
    expect(getInlineSupervisorStatus(makeEvent('fallback_invoked', 'execution'))).toBe('Retrying with a backup model.')
    expect(getInlineSupervisorStatus(makeEvent('gate_failed', 'execution'))).toBe('A check failed. Trying to recover.')
    expect(getInlineSupervisorStatus(makeEvent('run_completed', 'run', false))).toBe('The build hit an issue.')
  })

  it('ignores internal classification chatter', () => {
    expect(getInlineSupervisorStatus(makeEvent('intent_classified', 'routing'))).toBeNull()
  })
})
