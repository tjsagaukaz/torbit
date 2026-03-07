import type { SupervisorEvent } from '@/lib/supervisor/events'

export function getInlineSupervisorStatus(event: SupervisorEvent): string | null {
  switch (event.event) {
    case 'run_started':
      return '🤝 I’m on it and getting the build moving.'
    case 'route_selected':
      return typeof event.details.route === 'string' && event.details.route.includes('fast')
        ? '⚡ Taking the fast build lane so I can start working sooner.'
        : '🧭 Using the deeper build lane for a higher-risk request.'
    case 'gate_started':
      if (event.stage === 'vibe_audit') return '👀 Checking the current project before I touch files.'
      if (event.stage === 'brief') return '🧩 Packing your request, context, and rules into the build brief.'
      if (event.stage === 'planning') return '🧠 Laying out the build plan.'
      if (event.stage === 'implementation') return '🛠️ Starting the first file changes.'
      if (event.stage === 'execution') return '🛠️ Handing the build brief to the builder.'
      return '⚙️ Moving through the next build step.'
    case 'gate_passed':
      if (event.stage === 'vibe_audit') return '✅ Project check looks good. Moving into the build.'
      if (event.stage === 'brief') return '✅ Build brief is ready. Starting the first pass.'
      if (event.stage === 'planning') return '✅ Plan is ready. Starting the build.'
      if (event.stage === 'implementation') return '✅ First build pass finished cleanly.'
      if (event.stage === 'execution') return '✅ That step landed cleanly.'
      return null
    case 'gate_failed':
      return '⚠️ Hit an issue. I’m trying the safest recovery path.'
    case 'autofix_started':
      return '🧹 Cleaning up issues I found along the way.'
    case 'autofix_succeeded':
      return '✅ Cleanup worked. Continuing.'
    case 'autofix_failed':
      return '⚠️ Automatic cleanup could not finish that fix.'
    case 'fallback_invoked':
      return '🔁 Hit a snag. Switching to a backup path and keeping the build alive.'
    case 'run_completed':
      return event.details.success === false ? '⚠️ I hit an issue before the finish line.' : '🎉 Your update is ready.'
    case 'intent_classified':
    default:
      return null
  }
}
