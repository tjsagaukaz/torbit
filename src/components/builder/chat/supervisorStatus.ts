import type { SupervisorEvent } from '@/lib/supervisor/events'

export function getInlineSupervisorStatus(event: SupervisorEvent): string | null {
  switch (event.event) {
    case 'run_started':
      return 'Starting your build.'
    case 'route_selected':
      return 'Planning the build.'
    case 'gate_started':
      if (event.stage === 'vibe_audit') return 'Checking the project before building.'
      if (event.stage === 'execution') return 'Starting file changes.'
      return 'Working through the build.'
    case 'gate_passed':
      if (event.stage === 'vibe_audit') return 'Checks passed. Moving into the build.'
      if (event.stage === 'execution') return 'Build step finished.'
      return null
    case 'gate_failed':
      return 'A check failed. Trying to recover.'
    case 'autofix_started':
      return 'Cleaning up issues found during checks.'
    case 'autofix_succeeded':
      return 'Cleanup worked. Continuing.'
    case 'autofix_failed':
      return 'Automatic cleanup could not finish the fix.'
    case 'fallback_invoked':
      return 'Retrying with a backup model.'
    case 'run_completed':
      return event.details.success === false ? 'The build hit an issue.' : 'Build finished.'
    case 'intent_classified':
    default:
      return null
  }
}
