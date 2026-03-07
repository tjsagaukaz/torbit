export interface InitialAssistantResponse {
  content: string
  statusLines: string[]
}

export function getInitialAssistantResponse(message: string): InitialAssistantResponse {
  const normalized = message.toLowerCase().trim()

  if (!normalized) {
    return {
      content: 'I’m ready when you are 👋',
      statusLines: [
        '🧭 Getting oriented.',
        '👀 Waiting for the first clear direction.',
      ],
    }
  }

  if (/\b(debug|fix|bug|error|failing|not working|crash)\b/.test(normalized)) {
    return {
      content: 'I’m on it. Let me trace the issue and fix it 🩺',
      statusLines: [
        '🔎 Reproducing the issue.',
        '🧠 Checking where it breaks before I patch it.',
      ],
    }
  }

  if (/\b(edit|change|update|modify|refactor|improve|remove|add)\b/.test(normalized)) {
    return {
      content: 'On it. I’m opening the current files and making the update ✍️',
      statusLines: [
        '👀 Reading the current code.',
        '🛠️ Lining up the change.',
      ],
    }
  }

  if (/\b(create|build|generate|make|scaffold|start)\b/.test(normalized)) {
    return {
      content: 'I’m on it. I’ll build the first pass and keep you posted as I go ✨',
      statusLines: [
        '🧭 Mapping the first pass.',
        '👀 Checking the current project before I touch files.',
      ],
    }
  }

  return {
    content: 'On it. I’ll work through it and keep you posted 🤝',
    statusLines: [
      '🧭 Getting oriented.',
      '👀 Checking your request and the current project.',
    ],
  }
}

export function getInitialAssistantMessage(message: string): string {
  return getInitialAssistantResponse(message).content
}

export function getInitialAssistantStatusLines(message: string): string[] {
  return getInitialAssistantResponse(message).statusLines
}
