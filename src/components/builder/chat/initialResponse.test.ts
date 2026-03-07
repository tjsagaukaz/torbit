import { describe, expect, it } from 'vitest'
import { getInitialAssistantMessage } from './initialResponse'

describe('getInitialAssistantMessage', () => {
  it('acknowledges build requests immediately', () => {
    expect(getInitialAssistantMessage('Build me a landing page')).toBe('Starting the build now.')
    expect(getInitialAssistantMessage('generate a dashboard')).toBe('Starting the build now.')
  })

  it('acknowledges edit requests immediately', () => {
    expect(getInitialAssistantMessage('update the header copy')).toBe('Making those changes now.')
  })

  it('acknowledges debug requests immediately', () => {
    expect(getInitialAssistantMessage('fix the preview error')).toBe('Looking into the issue now.')
  })

  it('falls back to a generic acknowledgement', () => {
    expect(getInitialAssistantMessage('help with this app')).toBe('Working on that now.')
    expect(getInitialAssistantMessage('')).toBe('Starting now.')
  })
})
