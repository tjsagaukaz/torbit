import { describe, expect, it } from 'vitest'
import { selectExecutionStrategy } from './executionStrategy'

describe('selectExecutionStrategy', () => {
  it('uses the fast lane for standard product builds', () => {
    expect(selectExecutionStrategy({
      agentId: 'architect',
      userPrompt: 'Build an Apple-style typing game for desktop and mobile.',
      fileCount: 12,
    })).toEqual({
      strategy: 'fast_lane',
      reason: 'standard interactive build',
    })
  })

  it('uses the deep path for risky backend work', () => {
    expect(selectExecutionStrategy({
      agentId: 'backend',
      userPrompt: 'Add Stripe subscriptions and webhook handling.',
      fileCount: 30,
    })).toEqual({
      strategy: 'world_class',
      reason: 'high-risk agent route',
    })
  })

  it('uses the deep path for large workspace context', () => {
    expect(selectExecutionStrategy({
      agentId: 'architect',
      userPrompt: 'Refactor the app shell.',
      fileCount: 220,
    })).toEqual({
      strategy: 'world_class',
      reason: 'large workspace context',
    })
  })
})
