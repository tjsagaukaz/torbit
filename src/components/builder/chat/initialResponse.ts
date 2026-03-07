export function getInitialAssistantMessage(message: string): string {
  const normalized = message.toLowerCase().trim()

  if (!normalized) return 'Starting now.'

  if (/\b(debug|fix|bug|error|failing|not working|crash)\b/.test(normalized)) {
    return 'Looking into the issue now.'
  }

  if (/\b(edit|change|update|modify|refactor|improve|remove|add)\b/.test(normalized)) {
    return 'Making those changes now.'
  }

  if (/\b(create|build|generate|make|scaffold|start)\b/.test(normalized)) {
    return 'Starting the build now.'
  }

  return 'Working on that now.'
}
