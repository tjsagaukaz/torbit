import { describe, expect, it } from 'vitest'
import {
  getInitialAssistantMessage,
  getInitialAssistantStatusLines,
} from './initialResponse'

describe('getInitialAssistantMessage', () => {
  it('acknowledges build requests immediately', () => {
    expect(getInitialAssistantMessage('Build me a landing page')).toBe(
      'I’m on it. I’ll build the first pass and keep you posted as I go ✨'
    )
    expect(getInitialAssistantStatusLines('generate a dashboard')).toEqual([
      '🧭 Mapping the first pass.',
      '👀 Checking the current project before I touch files.',
    ])
  })

  it('acknowledges edit requests immediately', () => {
    expect(getInitialAssistantMessage('update the header copy')).toBe(
      'On it. I’m opening the current files and making the update ✍️'
    )
  })

  it('acknowledges debug requests immediately', () => {
    expect(getInitialAssistantMessage('fix the preview error')).toBe(
      'I’m on it. Let me trace the issue and fix it 🩺'
    )
  })

  it('falls back to a generic acknowledgement', () => {
    expect(getInitialAssistantMessage('help with this app')).toBe(
      'On it. I’ll work through it and keep you posted 🤝'
    )
    expect(getInitialAssistantMessage('')).toBe('I’m ready when you are 👋')
  })
})
