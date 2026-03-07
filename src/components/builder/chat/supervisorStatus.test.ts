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
    expect(getInlineSupervisorStatus(makeEvent('run_started', 'run'))).toBe('🤝 I’m on it and getting the build moving.')
    expect(getInlineSupervisorStatus(makeEvent('route_selected', 'routing'))).toBe('🧭 Lining up the best first pass.')
    expect(getInlineSupervisorStatus(makeEvent('gate_started', 'vibe_audit'))).toBe('👀 Checking the current project before I touch files.')
    expect(getInlineSupervisorStatus(makeEvent('gate_started', 'brief'))).toBe('🧩 Packing your request, context, and rules into the build brief.')
    expect(getInlineSupervisorStatus(makeEvent('gate_started', 'execution'))).toBe('🛠️ Handing the build brief to the builder.')
  })

  it('maps fallback and failure events', () => {
    expect(getInlineSupervisorStatus(makeEvent('fallback_invoked', 'execution'))).toBe('🔁 Hit a snag. Switching to a backup path and keeping the build alive.')
    expect(getInlineSupervisorStatus(makeEvent('gate_failed', 'execution'))).toBe('⚠️ Hit an issue. I’m trying the safest recovery path.')
    expect(getInlineSupervisorStatus(makeEvent('run_completed', 'run', false))).toBe('⚠️ I hit an issue before the finish line.')
  })

  it('ignores internal classification chatter', () => {
    expect(getInlineSupervisorStatus(makeEvent('intent_classified', 'routing'))).toBeNull()
  })
})
