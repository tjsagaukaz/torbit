/**
 * TORBIT ORCHESTRATOR
 *
 * The central nervous system that wires agents to the Vercel AI SDK.
 * This file handles tool execution, agent routing, and the audit pipeline.
 *
 * Routing is deterministic via the governance-backed router — no LLM calls
 * for agent selection. See `router.ts` for the algorithm.
 */

import { streamText, stepCountIs } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { z } from 'zod'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentId } from '../tools/definitions'
import { executeTool, createExecutionContext, type ToolExecutionContext } from '../tools/executor'
import { createAgentTools } from '../tools/ai-sdk-tools'
import { routeRequest, type RoutingDecision, AmbiguousRoutingError } from './router'
import { checkCircuitBreaker, calculateFuelCost, type ModelTier as FuelModelTier } from '@/store/fuel'
import { parseGovernanceOutput, formatGovernanceForAgent, formatInvariantsForQA, type GovernanceObject } from './governance'

// Agent prompts
import { AUDITOR_SYSTEM_PROMPT } from './prompts/auditor'
import { ARCHITECT_SYSTEM_PROMPT } from './prompts/architect'
import { BACKEND_SYSTEM_PROMPT } from './prompts/backend'
import { PLANNER_SYSTEM_PROMPT } from './prompts/planner'
import { STRATEGIST_SYSTEM_PROMPT } from './prompts/strategist'
import { FRONTEND_SYSTEM_PROMPT } from './prompts/frontend'
import { DEVOPS_SYSTEM_PROMPT } from './prompts/devops'
import { QA_SYSTEM_PROMPT } from './prompts/qa'

// ============================================
// TYPES
// ============================================

export type ModelTier = 'opus' | 'sonnet' | 'flash'

export interface OrchestrationConfig {
  projectId: string
  userId: string
  modelTier?: ModelTier
  enableAudit?: boolean
  enableTicketSync?: boolean
  mcpServers?: Array<{ name: string; url: string }>
}

export interface AgentResult {
  agentId: AgentId
  success: boolean
  output: string
  toolCalls: Array<{
    name: string
    args: Record<string, unknown>
    result: unknown
    duration: number
  }>
  duration: number
}

export interface AuditResult {
  passed: boolean
  gates: {
    visual: { passed: boolean; issues: string[] }
    functional: { passed: boolean; issues: string[] }
    hygiene: { passed: boolean; issues: string[] }
    security: { passed: boolean; issues: string[] }
  }
}

export interface PreflightResult {
  feasible: boolean
  reason?: string
  estimatedComplexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'architectural'
  estimatedFuel: { min: number; max: number }
  warnings?: string[]
}

export interface ParallelTask {
  agent: AgentId
  prompt: string
  modelTier?: ModelTier
}

export interface ParallelResult {
  results: AgentResult[]
  merged?: AgentResult
  checkpoint: string
  totalDuration: number
  parallelSpeedup: number // Theoretical sequential time / actual parallel time
}

export interface WorldClassExecutionOptions {
  systemPrompt?: string
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  maxSteps?: number
  maxTokens?: number
  onTextDelta?: (delta: string) => void
  onToolCall?: (toolCall: { id: string; name: string; args: Record<string, unknown> }) => void
  onToolResult?: (toolResult: { id: string; name: string; result: unknown; duration: number }) => void
}

// ============================================
// MODEL SELECTION (Kimi K2.5 Primary + Claude Governance)
// ============================================

const USE_CODEX_PRIMARY = process.env.TORBIT_USE_CODEX_PRIMARY === 'true'
const CODEX_PRIMARY_MODEL = process.env.TORBIT_CODEX_MODEL || process.env.OPENAI_CODEX_MODEL || 'gpt-5.3-codex'
const CODEX_FAST_MODEL = process.env.TORBIT_CODEX_FAST_MODEL || 'gpt-5-mini'
const OPENAI_FALLBACK_MODEL = process.env.TORBIT_OPENAI_FALLBACK_MODEL || 'gpt-5-mini'
const KIMI_FALLBACK_MODEL = process.env.TORBIT_KIMI_FALLBACK_MODEL || 'moonshotai/kimi-k2.5'
const KIMI_FAST_FALLBACK_MODEL = process.env.TORBIT_KIMI_FAST_FALLBACK_MODEL || KIMI_FALLBACK_MODEL
const ANTHROPIC_OPUS_MODEL = process.env.TORBIT_ANTHROPIC_OPUS_MODEL || 'claude-opus-4-1-20250805'
const ANTHROPIC_SONNET_MODEL = process.env.TORBIT_ANTHROPIC_SONNET_MODEL || 'claude-sonnet-4-20250514'
const GOOGLE_PRO_MODEL = 'gemini-2.5-pro'
const GOOGLE_FLASH_MODEL = 'gemini-2.5-flash'
const CONTEXT_COMPILER_MODEL = process.env.TORBIT_CONTEXT_COMPILER_MODEL || process.env.TORBIT_GEMINI_CONTEXT_MODEL || 'gemini-3-pro-preview'
const SUPERVISOR_MODEL = process.env.TORBIT_SUPERVISOR_MODEL || process.env.TORBIT_SUPERVISOR_CODEX_MODEL || 'gpt-5.2'
const WORKER_PRIMARY_MODEL = process.env.TORBIT_WORKER_MODEL || process.env.TORBIT_KIMI_WORKER_MODEL || KIMI_FALLBACK_MODEL
const CRITICAL_MODEL = process.env.TORBIT_CRITICAL_MODEL || process.env.TORBIT_OPUS_MODEL || ANTHROPIC_OPUS_MODEL
const JANITOR_MODEL = process.env.TORBIT_JANITOR_MODEL || process.env.TORBIT_SONNET_MODEL || ANTHROPIC_SONNET_MODEL
const WORLD_CLASS_CONTEXT_MIN_CHARS = Number(process.env.TORBIT_CONTEXT_COMPILER_MIN_CHARS || 10000)
const PROVIDER_BILLING_BACKOFF_MS = Number(process.env.TORBIT_PROVIDER_BILLING_BACKOFF_MS || 15 * 60 * 1000)
let codexFallbackWarningShown = false
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

type ModelCandidate = {
  provider: 'anthropic' | 'openai' | 'google' | 'openrouter'
  label: string
  model: ReturnType<typeof anthropic> | ReturnType<typeof openai> | ReturnType<typeof google> | ReturnType<typeof openrouter>
}

function normalizeAnthropicAlias(model: string): string {
  if (model === 'claude-opus-4-6') return ANTHROPIC_OPUS_MODEL
  if (model === 'claude-opus-4-1') return ANTHROPIC_OPUS_MODEL
  if (model === 'claude-sonnet-4-5') return ANTHROPIC_SONNET_MODEL
  if (model === 'claude-sonnet-4') return ANTHROPIC_SONNET_MODEL
  return model
}

function addConfiguredModelCandidate(input: {
  model: string
  addOpenAI: (label: string) => void
  addAnthropic: (label: string) => void
  addGoogle: (label: string) => void
  addOpenRouter: (label: string) => void
}) {
  const normalized = normalizeAnthropicAlias(input.model)
  if (normalized.startsWith('claude-')) {
    input.addAnthropic(normalized)
    return
  }
  if (normalized.startsWith('gemini-')) {
    input.addGoogle(normalized)
    return
  }
  if (normalized.includes('/')) {
    input.addOpenRouter(normalized)
    return
  }
  input.addOpenAI(normalized)
}

export type ModelRole = 'default' | 'context' | 'supervisor' | 'worker' | 'critical' | 'janitor'

const SupervisorPlanSchema = z.object({
  risk: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  executeJanitor: z.boolean().default(true),
  escalateToCritical: z.boolean().default(false),
  workerDirective: z.string().min(1).default('Implement the request directly with concrete file changes.'),
  janitorDirective: z.string().default('Run a focused cleanup pass: lint/type/test failures, minimal edits only.'),
  criticalDirective: z.string().default('Repair blockers and regressions with minimal, surgical fixes.'),
  notes: z.array(z.string()).default([]),
})

type SupervisorPlan = z.infer<typeof SupervisorPlanSchema>

const DEFAULT_SUPERVISOR_PLAN: SupervisorPlan = {
  risk: 'medium',
  executeJanitor: true,
  escalateToCritical: false,
  workerDirective: 'Implement the request directly with concrete file changes.',
  janitorDirective: 'Run a focused cleanup pass: lint/type/test failures, minimal edits only.',
  criticalDirective: 'Repair blockers and regressions with minimal, surgical fixes.',
  notes: [],
}

const providerBackoffUntil = new Map<ModelCandidate['provider'], number>()

function hasProviderBackoff(provider: ModelCandidate['provider'], now = Date.now()): boolean {
  const until = providerBackoffUntil.get(provider)
  if (!until) return false
  if (until <= now) {
    providerBackoffUntil.delete(provider)
    return false
  }
  return true
}

function setProviderBackoff(provider: ModelCandidate['provider'], durationMs = PROVIDER_BILLING_BACKOFF_MS): void {
  providerBackoffUntil.set(provider, Date.now() + durationMs)
  // Evict expired entries to prevent unbounded growth
  const now = Date.now()
  for (const [key, until] of providerBackoffUntil) {
    if (until <= now) providerBackoffUntil.delete(key)
  }
}

function isBillingOrQuotaFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes('credit balance') ||
    msg.includes('purchase credits') ||
    msg.includes('billing') ||
    msg.includes('insufficient credits') ||
    msg.includes('quota exceeded') ||
    msg.includes('status code: 402')
  )
}

function getModelCandidates(
  taskComplexity: 'high' | 'medium' | 'low',
  preferredTier?: ModelTier,
  role: ModelRole = 'default'
): ModelCandidate[] {
  const tier: ModelTier = preferredTier ?? (
    taskComplexity === 'high' ? 'opus' : taskComplexity === 'medium' ? 'sonnet' : 'flash'
  )

  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY)
  const hasGoogle = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY)
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY)
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY)
  const candidates: ModelCandidate[] = []
  const seen = new Set<string>()

  const addCandidate = (candidate: ModelCandidate) => {
    const key = `${candidate.provider}:${candidate.label}`
    if (seen.has(key)) return
    seen.add(key)
    candidates.push(candidate)
  }

  const addOpenAI = (label: string) => {
    if (!hasOpenAI) return
    addCandidate({ provider: 'openai', label, model: openai(label) })
  }
  const addAnthropic = (label: string) => {
    if (!hasAnthropic) return
    addCandidate({ provider: 'anthropic', label, model: anthropic(label) })
  }
  const addGoogle = (label: string) => {
    if (!hasGoogle) return
    addCandidate({ provider: 'google', label, model: google(label) })
  }
  const addOpenRouter = (label: string) => {
    if (!hasOpenRouter) return
    addCandidate({ provider: 'openrouter', label, model: openrouter.chat(label) })
  }

  switch (role) {
    case 'context':
      addGoogle(CONTEXT_COMPILER_MODEL)
      addGoogle(GOOGLE_PRO_MODEL)
      addOpenRouter(KIMI_FALLBACK_MODEL)
      addOpenAI(OPENAI_FALLBACK_MODEL)
      addAnthropic(ANTHROPIC_SONNET_MODEL)
      break
    case 'supervisor':
      addConfiguredModelCandidate({
        model: SUPERVISOR_MODEL,
        addOpenAI,
        addAnthropic,
        addGoogle,
        addOpenRouter,
      })
      addOpenAI(CODEX_PRIMARY_MODEL)
      addOpenAI(OPENAI_FALLBACK_MODEL)
      addOpenRouter(KIMI_FALLBACK_MODEL)
      addAnthropic(ANTHROPIC_SONNET_MODEL)
      addGoogle(GOOGLE_PRO_MODEL)
      break
    case 'worker':
      addOpenRouter(WORKER_PRIMARY_MODEL)
      addOpenRouter(KIMI_FALLBACK_MODEL)
      addAnthropic(ANTHROPIC_SONNET_MODEL)
      addOpenAI(OPENAI_FALLBACK_MODEL)
      addGoogle(GOOGLE_FLASH_MODEL)
      break
    case 'critical':
      addConfiguredModelCandidate({
        model: CRITICAL_MODEL,
        addOpenAI,
        addAnthropic,
        addGoogle,
        addOpenRouter,
      })
      addConfiguredModelCandidate({
        model: SUPERVISOR_MODEL,
        addOpenAI,
        addAnthropic,
        addGoogle,
        addOpenRouter,
      })
      addOpenRouter(KIMI_FALLBACK_MODEL)
      addGoogle(GOOGLE_PRO_MODEL)
      break
    case 'janitor':
      addConfiguredModelCandidate({
        model: JANITOR_MODEL,
        addOpenAI,
        addAnthropic,
        addGoogle,
        addOpenRouter,
      })
      addOpenRouter(KIMI_FAST_FALLBACK_MODEL)
      addOpenAI(OPENAI_FALLBACK_MODEL)
      addGoogle(GOOGLE_FLASH_MODEL)
      break
    case 'default':
    default:
      if (tier === 'flash') {
        addGoogle(GOOGLE_FLASH_MODEL)
        addOpenAI(USE_CODEX_PRIMARY ? CODEX_FAST_MODEL : OPENAI_FALLBACK_MODEL)
        addOpenRouter(KIMI_FAST_FALLBACK_MODEL)
        addAnthropic(ANTHROPIC_SONNET_MODEL)
      } else {
        if (USE_CODEX_PRIMARY) addOpenAI(CODEX_PRIMARY_MODEL)
        addAnthropic(tier === 'opus' ? ANTHROPIC_OPUS_MODEL : ANTHROPIC_SONNET_MODEL)
        addOpenRouter(KIMI_FALLBACK_MODEL)
        addOpenAI(OPENAI_FALLBACK_MODEL)
        addGoogle(tier === 'opus' ? GOOGLE_PRO_MODEL : GOOGLE_FLASH_MODEL)
      }
      break
  }

  if (role === 'default' && USE_CODEX_PRIMARY && !hasOpenAI && !codexFallbackWarningShown) {
    codexFallbackWarningShown = true
    console.warn('[Orchestrator] TORBIT_USE_CODEX_PRIMARY=true but OPENAI_API_KEY is missing. Falling back to available providers.')
  }

  const eligibleCandidates = candidates.filter((candidate) => !hasProviderBackoff(candidate.provider))

  if (eligibleCandidates.length === 0 && candidates.length > 0) {
    return candidates
  }

  if (eligibleCandidates.length === 0) {
    throw new Error(
      'No AI provider configured. Set at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY.'
    )
  }

  return eligibleCandidates
}

function shouldFallbackToNextModel(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes('credit balance') ||
    msg.includes('purchase credits') ||
    msg.includes('billing') ||
    msg.includes('insufficient credits') ||
    msg.includes('quota exceeded') ||
    msg.includes('api key') ||
    msg.includes('authentication') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('status code: 402') ||
    msg.includes('status code: 401') ||
    msg.includes('status code: 403') ||
    msg.includes('status code: 429') ||
    msg.includes('too many requests') ||
    msg.includes('rate limit') ||
    msg.includes('model_not_found') ||
    msg.includes('does not exist or you do not have access')
  )
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return text.slice(start, i + 1)
  }
  return null
}

function estimateRequestChars(prompt: string, messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): number {
  const historySize = (messages || [])
    .map((message) => message.content.length)
    .reduce((sum, size) => sum + size, 0)
  return prompt.length + historySize
}

// ============================================
// AGENT SYSTEM PROMPTS
// ============================================

const AGENT_PROMPTS: Record<AgentId, string> = {
  architect: ARCHITECT_SYSTEM_PROMPT,
  frontend: FRONTEND_SYSTEM_PROMPT,
  backend: BACKEND_SYSTEM_PROMPT,           // Kimi K2.5: Fullstack Core (API + schemas)
  database: BACKEND_SYSTEM_PROMPT,          // Merged with backend - same prompt
  devops: DEVOPS_SYSTEM_PROMPT,
  qa: QA_SYSTEM_PROMPT,
  planner: PLANNER_SYSTEM_PROMPT,           // Kimi K2.5: Complex planning, dependency mapping
  strategist: STRATEGIST_SYSTEM_PROMPT,     // GPT-5.2: Reviews plans, NEVER first mover
  auditor: AUDITOR_SYSTEM_PROMPT,           // Opus: Judges quality, NEVER executes fixes
}

// ============================================
// TOOL CONVERSION FOR AI SDK
// ============================================

// Wrap tool definitions with execute handlers so multi-step tool loops continue.
function getToolsForAgent(agentId: AgentId, context: ToolExecutionContext) {
  return createAgentTools(agentId, context)
}

// ============================================
// UNFEASIBLE REQUEST PATTERNS
// ============================================

const UNFEASIBLE_PATTERNS = [
  { pattern: /build\s+(me\s+)?(a\s+)?facebook/i, reason: 'Request scope too large - Facebook-scale projects require months of work' },
  { pattern: /build\s+(me\s+)?(a\s+)?twitter/i, reason: 'Request scope too large - Twitter-scale projects require months of work' },
  { pattern: /build\s+(me\s+)?(a\s+)?amazon/i, reason: 'Request scope too large - Amazon-scale projects require months of work' },
  { pattern: /clone\s+(of\s+)?(facebook|twitter|instagram|tiktok|youtube)/i, reason: 'Social platform clones are beyond single-session scope' },
  { pattern: /hack|exploit|malware|virus|keylogger/i, reason: 'Malicious intent detected - request rejected' },
  { pattern: /bypass\s+(auth|security|paywall)/i, reason: 'Security bypass requests are not permitted' },
]

// ============================================
// MAIN ORCHESTRATOR
// ============================================

export class TorbitOrchestrator {
  private context: ToolExecutionContext
  private config: OrchestrationConfig

  // Circuit breaker state for this orchestration session
  private sessionStartTime: number = Date.now()
  private sessionRetries: number = 0
  private sessionFuelSpent: number = 0

  constructor(config: OrchestrationConfig) {
    this.config = config
    this.context = createExecutionContext(config.projectId, config.userId)

    // Initialize MCP connections if provided
    if (config.mcpServers) {
      for (const server of config.mcpServers) {
        this.context.mcpServers.set(server.name, {
          url: server.url,
          tools: [],
        })
      }
    }
  }
  
  /**
   * Pre-flight check - validate request before spending fuel
   * Uses Flash (cheap) to catch unreasonable requests early
   */
  preflight(userPrompt: string): PreflightResult {
    // Fast pattern matching first (no API call)
    for (const { pattern, reason } of UNFEASIBLE_PATTERNS) {
      if (pattern.test(userPrompt)) {
        return {
          feasible: false,
          reason,
          estimatedComplexity: 'architectural',
          estimatedFuel: { min: 0, max: 0 },
          warnings: ['Request rejected during pre-flight check'],
        }
      }
    }
    
    // Quick complexity estimation based on prompt characteristics
    const wordCount = userPrompt.split(/\s+/).length
    const hasMultipleFeatures = /and|also|plus|additionally|furthermore/i.test(userPrompt)
    const mentionsMultipleFiles = /files?|components?|pages?/gi.test(userPrompt)
    
    let estimatedComplexity: PreflightResult['estimatedComplexity'] = 'moderate'
    let estimatedFuel = { min: 20, max: 60 }
    const warnings: string[] = []
    
    if (wordCount > 200) {
      estimatedComplexity = 'complex'
      estimatedFuel = { min: 80, max: 200 }
      warnings.push('Long request - consider breaking into smaller tasks')
    } else if (wordCount < 10 && !hasMultipleFeatures) {
      estimatedComplexity = 'simple'
      estimatedFuel = { min: 5, max: 15 }
    } else if (hasMultipleFeatures || mentionsMultipleFiles) {
      estimatedComplexity = 'moderate'
      estimatedFuel = { min: 40, max: 100 }
    }
    
    // Check for architectural keywords
    if (/architect|redesign|refactor\s+(entire|all|whole)|migrate|rewrite/i.test(userPrompt)) {
      estimatedComplexity = 'architectural'
      estimatedFuel = { min: 150, max: 400 }
      warnings.push('Architectural change detected - high fuel consumption expected')
    }
    
    return {
      feasible: true,
      estimatedComplexity,
      estimatedFuel,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  }
  
  /**
   * Get routing decision using deterministic intent-based router
   */
  private getRoutingDecision(
    prompt: string,
    _context?: unknown
  ): RoutingDecision | null {
    try {
      return routeRequest(prompt)
    } catch (error) {
      if (error instanceof AmbiguousRoutingError) {
        console.warn('[Orchestrator] Ambiguous routing:', error.message)
        return null
      }
      console.warn('[Orchestrator] Routing failed:', error)
      return null
    }
  }
  
  /**
   * Execute a task with a specific agent
   * 
   * @param onToolCall - Optional callback fired IMMEDIATELY when each tool call starts,
   *                     enabling real-time file visibility in the UI before execution completes
   */
  async executeAgent(
    agentId: AgentId,
    prompt: string,
    options?: {
      modelTier?: ModelTier
      /** Force a model-role profile (context/supervisor/worker/critical/janitor) */
      modelRole?: ModelRole
      maxSteps?: number
      /** Maximum output tokens for the model response */
      maxTokens?: number
      /** Optional full message history (preferred over raw prompt when available) */
      messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
      /** Optional override for default agent system prompt */
      systemPrompt?: string
      /** Callback fired on every text delta */
      onTextDelta?: (delta: string) => void
      /** Callback fired immediately when a tool call is received (before execution) */
      onToolCall?: (toolCall: { id: string; name: string; args: Record<string, unknown> }) => void
      /** Callback fired when a tool call completes execution */
      onToolResult?: (toolResult: { id: string; name: string; result: unknown; duration: number }) => void
    }
  ): Promise<AgentResult> {
    const start = Date.now()
    
    // Check circuit breaker before execution
    const circuitCheck = checkCircuitBreaker(
      this.sessionFuelSpent,
      this.sessionRetries,
      this.sessionStartTime
    )
    if (circuitCheck.triggered) {
      return {
        agentId,
        success: false,
        output: `Circuit breaker tripped: ${circuitCheck.reason}`,
        toolCalls: [],
        duration: 0,
      }
    }
    
    const modelCandidates = getModelCandidates('medium', options?.modelTier, options?.modelRole ?? 'default')
    const tools = getToolsForAgent(agentId, this.context)
    const systemPrompt = options?.systemPrompt ?? AGENT_PROMPTS[agentId]
    const sanitizedMessages = options?.messages
      ?.filter((msg) => msg.content && msg.content.trim().length > 0)
      .map((msg) => ({ role: msg.role, content: msg.content }))
    
    // Map model tier to fuel model tier for cost calculation
    const fuelModelTier: FuelModelTier = options?.modelTier === 'opus' ? 'opus' :
                                          options?.modelTier === 'sonnet' ? 'sonnet' : 'flash'
    const fallbackErrors: string[] = []
    let lastError: unknown = null
    let lastToolCalls: AgentResult['toolCalls'] = []

    for (let i = 0; i < modelCandidates.length; i += 1) {
      const candidate = modelCandidates[i]
      const toolCalls: AgentResult['toolCalls'] = []
      const seenToolCalls = new Set<string>()
      const toolStartTimes = new Map<string, number>()
      const toolCallArgs = new Map<string, Record<string, unknown>>()

      try {
        const baseStreamOptions = {
          model: candidate.model,
          system: systemPrompt,
          tools,
          ...(options?.maxTokens ? { maxTokens: options.maxTokens } : {}),
          stopWhen: stepCountIs(options?.maxSteps ?? 10),
        }

        const result = sanitizedMessages && sanitizedMessages.length > 0
          ? await streamText({
            ...baseStreamOptions,
            messages: sanitizedMessages,
          })
          : await streamText({
            ...baseStreamOptions,
            prompt,
          })
        
        // Use fullStream to get tool calls IMMEDIATELY as they happen
        // This enables real-time file visibility before execution completes
        let output = ''
        let textDeltaBuffer = ''
        let lastTextFlush = Date.now()
        const TEXT_FLUSH_INTERVAL_MS = 50 // Cap at ~20 UI updates/sec

        const flushTextBuffer = () => {
          if (textDeltaBuffer) {
            options?.onTextDelta?.(textDeltaBuffer)
            textDeltaBuffer = ''
            lastTextFlush = Date.now()
          }
        }

        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            output += part.text
            textDeltaBuffer += part.text
            if (Date.now() - lastTextFlush >= TEXT_FLUSH_INTERVAL_MS) {
              flushTextBuffer()
            }
          } else if (part.type === 'error') {
            const streamError = (part as { error?: unknown }).error
            if (streamError instanceof Error) {
              throw streamError
            }
            if (typeof streamError === 'string') {
              throw new Error(streamError)
            }
            throw new Error(streamError ? JSON.stringify(streamError) : 'Model streaming failed')
          } else if (part.type === 'tool-call') {
            // Stream tool call immediately when it starts (with complete args)
            // AI SDK v6 uses 'input' not 'args' for tool parameters
            const tc = part as { toolCallId?: string; toolName: string; input?: unknown; args?: unknown }
            const toolCallId = tc.toolCallId ?? tc.toolName
            const args = (tc.input ?? tc.args ?? {}) as Record<string, unknown>
            
            if (!seenToolCalls.has(toolCallId)) {
              seenToolCalls.add(toolCallId)
              toolStartTimes.set(toolCallId, Date.now())
              toolCallArgs.set(toolCallId, args)
              
              // Notify caller immediately - this is the key fix!
              // Files will appear in sidebar as soon as the model decides to create them,
              // not after the entire step completes
              options?.onToolCall?.({
                id: toolCallId,
                name: tc.toolName,
                args,
              })
            }
          } else if (part.type === 'tool-result') {
            const tr = part as {
              toolCallId?: string
              toolName?: string
              output?: unknown
              result?: unknown
            }

            const toolCallId = tr.toolCallId ?? tr.toolName ?? `tool-${Date.now()}`
            const toolName = tr.toolName ?? 'unknown'
            const rawResult = tr.output ?? tr.result ?? null
            const duration = Date.now() - (toolStartTimes.get(toolCallId) ?? Date.now())

            // Track fuel cost per tool call with model tier multiplier
            const baseFuelCost = 1
            const adjustedCost = calculateFuelCost(baseFuelCost, fuelModelTier)
            this.sessionFuelSpent += adjustedCost

            toolCalls.push({
              name: toolName,
              args: toolCallArgs.get(toolCallId) ?? {},
              result: rawResult,
              duration,
            })

            options?.onToolResult?.({
              id: toolCallId,
              name: toolName,
              result: rawResult,
              duration,
            })
          }
        }

        // Flush any remaining buffered text deltas
        flushTextBuffer()

        return {
          agentId,
          success: true,
          output,
          toolCalls,
          duration: Date.now() - start,
        }
      } catch (error) {
        this.sessionRetries++
        lastError = error
        lastToolCalls = toolCalls
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        if (isBillingOrQuotaFailure(error)) {
          setProviderBackoff(candidate.provider)
          console.warn(
            `[Orchestrator] Provider ${candidate.provider} entered temporary billing backoff for ${Math.round(PROVIDER_BILLING_BACKOFF_MS / 1000)}s.`
          )
        }

        fallbackErrors.push(`${candidate.provider}:${candidate.label} -> ${errorMessage}`)

        const nextCandidate = modelCandidates[i + 1]
        if (nextCandidate && shouldFallbackToNextModel(error)) {
          console.warn(
            `[Orchestrator] Model ${candidate.provider}:${candidate.label} failed. Falling back to ${nextCandidate.provider}:${nextCandidate.label}.`,
            error
          )
          continue
        }

        break
      }
    }

    if (fallbackErrors.length > 0) {
      console.error('[Orchestrator] Model fallback chain exhausted', {
        agent: agentId,
        attempts: fallbackErrors.length,
        candidates: modelCandidates.map((c) => `${c.provider}:${c.label}`),
        errors: fallbackErrors,
        sessionRetries: this.sessionRetries,
        fuelSpent: this.sessionFuelSpent,
        durationMs: Date.now() - start,
      })
    }

    return {
      agentId,
      success: false,
      output: `Error: ${lastError instanceof Error ? lastError.message : 'Unknown error'}`,
      toolCalls: lastToolCalls,
      duration: Date.now() - start,
    }
  }

  private async runTextStepWithRole(
    role: Exclude<ModelRole, 'default'>,
    systemPrompt: string,
    prompt: string,
    options?: { modelTier?: ModelTier; maxTokens?: number }
  ): Promise<{ success: boolean; output: string; modelLabel?: string; error?: string }> {
    const modelCandidates = getModelCandidates('medium', options?.modelTier, role)
    let lastError: unknown = null
    const fallbackErrors: string[] = []

    for (let i = 0; i < modelCandidates.length; i += 1) {
      const candidate = modelCandidates[i]
      try {
        const result = await streamText({
          model: candidate.model,
          system: systemPrompt,
          prompt,
          ...(options?.maxTokens ? { maxTokens: options.maxTokens } : {}),
          stopWhen: stepCountIs(1),
        })

        let output = ''
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            output += part.text
          } else if (part.type === 'error') {
            const streamError = (part as { error?: unknown }).error
            if (streamError instanceof Error) throw streamError
            if (typeof streamError === 'string') throw new Error(streamError)
            throw new Error(streamError ? JSON.stringify(streamError) : 'Model streaming failed')
          }
        }

        return {
          success: true,
          output: output.trim(),
          modelLabel: `${candidate.provider}:${candidate.label}`,
        }
      } catch (error) {
        lastError = error
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        if (isBillingOrQuotaFailure(error)) {
          setProviderBackoff(candidate.provider)
          console.warn(
            `[Orchestrator] Provider ${candidate.provider} entered temporary billing backoff for ${Math.round(PROVIDER_BILLING_BACKOFF_MS / 1000)}s.`
          )
        }
        fallbackErrors.push(`${candidate.provider}:${candidate.label} -> ${errorMessage}`)

        const nextCandidate = modelCandidates[i + 1]
        if (nextCandidate && shouldFallbackToNextModel(error)) {
          console.warn(
            `[Orchestrator] Control step (${role}) model ${candidate.provider}:${candidate.label} failed. Falling back to ${nextCandidate.provider}:${nextCandidate.label}.`,
            error
          )
          continue
        }
        break
      }
    }

    if (fallbackErrors.length > 0) {
      console.error(`[Orchestrator] Control step (${role}) fallback chain exhausted`, {
        role,
        attempts: fallbackErrors.length,
        candidates: modelCandidates.map((c) => `${c.provider}:${c.label}`),
        errors: fallbackErrors,
      })
    }

    return {
      success: false,
      output: '',
      error: lastError instanceof Error ? lastError.message : 'Unknown error',
    }
  }

  private resolveSupervisorPlan(raw: string): SupervisorPlan {
    const jsonBlob = extractFirstJsonObject(raw)
    if (!jsonBlob) return { ...DEFAULT_SUPERVISOR_PLAN }
    try {
      const parsed = JSON.parse(jsonBlob)
      const validated = SupervisorPlanSchema.safeParse(parsed)
      if (!validated.success) {
        return { ...DEFAULT_SUPERVISOR_PLAN }
      }
      return validated.data
    } catch {
      return { ...DEFAULT_SUPERVISOR_PLAN }
    }
  }

  /**
   * World-class orchestration pipeline:
   * 1) Large-context compiler
   * 2) Supervisor plan
   * 3) Worker execution
   * 4) Critical rescue (if needed)
   * 5) Janitor cleanup pass
   * 6) Final supervisor review
   */
  async executeWorldClassFlow(
    agentId: AgentId,
    prompt: string,
    options?: WorldClassExecutionOptions
  ): Promise<AgentResult> {
    const start = Date.now()
    const sanitizedMessages = options?.messages
      ?.filter((msg) => msg.content && msg.content.trim().length > 0)
      .map((msg) => ({ role: msg.role, content: msg.content }))

    const requestedChars = estimateRequestChars(prompt, sanitizedMessages)
    const shouldCompileContext = requestedChars >= WORLD_CLASS_CONTEXT_MIN_CHARS

    let executionPrompt = prompt
    let contextCompilerOutput: string | null = null

    if (shouldCompileContext) {
      const contextCompilerSystemPrompt = [
        'You are a context compiler.',
        'Produce a concise, implementation-ready execution brief from large context.',
        'Do not include chain-of-thought.',
        'Output plain text with these sections:',
        'Goal, Constraints, Existing Surfaces, Plan, Acceptance Criteria.',
      ].join('\n')

      const historyPreview = (sanitizedMessages || [])
        .slice(-12)
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join('\n\n')

      const compilePrompt = [
        'Compile this into an execution brief for the coding worker.',
        '',
        'REQUEST:',
        prompt,
        historyPreview ? '\nRECENT HISTORY:\n' + historyPreview : '',
      ].join('\n')

      const contextResult = await this.runTextStepWithRole('context', contextCompilerSystemPrompt, compilePrompt, {
        modelTier: 'opus',
        maxTokens: 4096,
      })

      if (contextResult.success && contextResult.output.trim().length > 0) {
        contextCompilerOutput = contextResult.output.trim()
        executionPrompt = `${prompt}\n\n## COMPILED CONTEXT\n${contextCompilerOutput}`
      }
    }

    const supervisorSystemPrompt = [
      'You are the build supervisor.',
      'Return JSON only. No markdown.',
      'Keys: risk, executeJanitor, escalateToCritical, workerDirective, janitorDirective, criticalDirective, notes.',
      'risk must be one of: low, medium, high, critical.',
      'workerDirective must be specific and implementation-oriented.',
      'janitorDirective and criticalDirective must be concise and actionable.',
    ].join('\n')

    const supervisorPlanPrompt = [
      'Create a control plan for the worker run.',
      '',
      'User request:',
      prompt,
      '',
      contextCompilerOutput ? `Compiled context:\n${contextCompilerOutput}\n` : '',
      'Guidance:',
      '- Set executeJanitor true for most code changes.',
      '- Set escalateToCritical true for security/infra/auth/payment/high-risk changes.',
      '- Keep directives tightly scoped.',
    ].join('\n')

    const supervisorPlanResult = await this.runTextStepWithRole('supervisor', supervisorSystemPrompt, supervisorPlanPrompt, {
      modelTier: 'sonnet',
      maxTokens: 1800,
    })

    const supervisorPlan = this.resolveSupervisorPlan(supervisorPlanResult.output)

    const workerPrompt = [
      executionPrompt,
      '',
      '## EXECUTION DIRECTIVE',
      supervisorPlan.workerDirective,
    ].join('\n')

    const workerMessages = (() => {
      if (!sanitizedMessages || sanitizedMessages.length === 0) return undefined
      const mergedMessages = [...sanitizedMessages]
      const last = mergedMessages[mergedMessages.length - 1]
      if (last.role === 'user') {
        mergedMessages[mergedMessages.length - 1] = { role: 'user', content: workerPrompt }
      } else {
        mergedMessages.push({ role: 'user', content: workerPrompt })
      }
      return mergedMessages
    })()

    const workerResult = await this.executeAgent(agentId, workerPrompt, {
      modelRole: 'worker',
      modelTier: options?.maxSteps && options.maxSteps > 10 ? 'opus' : 'sonnet',
      maxSteps: options?.maxSteps,
      maxTokens: options?.maxTokens,
      messages: workerMessages,
      systemPrompt: options?.systemPrompt,
      onTextDelta: options?.onTextDelta,
      onToolCall: options?.onToolCall,
      onToolResult: options?.onToolResult,
    })

    const allToolCalls = [...workerResult.toolCalls]
    const outputSections: string[] = []
    if (workerResult.output.trim()) outputSections.push(workerResult.output.trim())

    let overallSuccess = workerResult.success
    const shouldRunCritical =
      !workerResult.success ||
      supervisorPlan.escalateToCritical ||
      supervisorPlan.risk === 'critical'

    if (shouldRunCritical) {
      const criticalPrompt = [
        'Critical rescue mode.',
        'Fix only blocking issues and regressions with minimal changes.',
        'Do not expand scope.',
        '',
        'Original request:',
        prompt,
        '',
        'Worker output/errors:',
        workerResult.output || 'No worker output captured.',
        '',
        'Critical directive:',
        supervisorPlan.criticalDirective,
      ].join('\n')

      const criticalResult = await this.executeAgent('architect', criticalPrompt, {
        modelRole: 'critical',
        modelTier: 'opus',
        maxSteps: Math.min(options?.maxSteps ?? 10, 10),
        maxTokens: options?.maxTokens,
        systemPrompt: options?.systemPrompt,
        onTextDelta: options?.onTextDelta,
        onToolCall: options?.onToolCall,
        onToolResult: options?.onToolResult,
      })

      allToolCalls.push(...criticalResult.toolCalls)
      if (criticalResult.output.trim()) outputSections.push(criticalResult.output.trim())
      overallSuccess = overallSuccess || criticalResult.success
    }

    if (overallSuccess && supervisorPlan.executeJanitor) {
      const janitorPrompt = [
        'Janitor pass.',
        'Perform minimal cleanup only:',
        '- Run lint/type/test checks as needed.',
        '- Apply only surgical fixes.',
        '- No new features.',
        '- Keep behavior unchanged.',
        '',
        'Directive:',
        supervisorPlan.janitorDirective,
      ].join('\n')

      const janitorResult = await this.executeAgent('qa', janitorPrompt, {
        modelRole: 'janitor',
        modelTier: 'sonnet',
        maxSteps: 6,
        maxTokens: Math.min(options?.maxTokens ?? 4096, 4096),
        onTextDelta: options?.onTextDelta,
        onToolCall: options?.onToolCall,
        onToolResult: options?.onToolResult,
      })

      allToolCalls.push(...janitorResult.toolCalls)
      if (janitorResult.output.trim()) outputSections.push(janitorResult.output.trim())
    }

    const finalReviewSystemPrompt = [
      'You are the final review supervisor.',
      'Write a concise production review with: Result, Key Changes, Risks, and Next Action.',
      'No chain-of-thought.',
    ].join('\n')

    const finalReviewPrompt = [
      `Risk: ${supervisorPlan.risk}`,
      `Execution success: ${overallSuccess ? 'yes' : 'no'}`,
      '',
      'Supervisor notes:',
      supervisorPlan.notes.join('; ') || 'none',
      '',
      'Execution transcript:',
      outputSections.join('\n\n').slice(0, 7000) || 'No output.',
    ].join('\n')

    const finalReview = await this.runTextStepWithRole('supervisor', finalReviewSystemPrompt, finalReviewPrompt, {
      modelTier: 'sonnet',
      maxTokens: 1200,
    })

    if (finalReview.success && finalReview.output.trim().length > 0) {
      const reviewBlock = `\n\n## Review Summary\n${finalReview.output.trim()}`
      outputSections.push(reviewBlock.trim())
      options?.onTextDelta?.(reviewBlock)
    }

    return {
      agentId,
      success: overallSuccess,
      output: outputSections.join('\n\n').trim() || 'Execution completed.',
      toolCalls: allToolCalls,
      duration: Date.now() - start,
    }
  }
  
  /**
   * Run the full audit pipeline
   */
  async runAuditPipeline(): Promise<{
    passed: boolean
    gates: {
      visual: { passed: boolean; issues: string[] }
      functional: { passed: boolean; issues: string[] }
      hygiene: { passed: boolean; issues: string[] }
      security: { passed: boolean; issues: string[] }
    }
    fixes: string[]
  }> {
    const gates = {
      visual: { passed: true, issues: [] as string[] },
      functional: { passed: true, issues: [] as string[] },
      hygiene: { passed: true, issues: [] as string[] },
      security: { passed: true, issues: [] as string[] },
    }
    const fixes: string[] = []
    
    // Type helper for tool results
    type VisualResult = { passed: boolean; violations?: Array<{ element: string; issue: string }> }
    type E2EResult = { passed: boolean; healedCount?: number }
    type LogsResult = { logs: Array<{ message: string; level: string }> }
    
    // Gate 1: Visual Inspection
    const screenshotResult = await executeTool('captureScreenshot', { route: '/' }, this.context)
    if (screenshotResult.success && screenshotResult.data) {
      const visualResult = await executeTool('verifyVisualMatch', {
        url: 'http://localhost:3000',
        compareWith: 'design-tokens',
        strict: false,
      }, this.context)
      
      const visualData = visualResult.data as VisualResult | undefined
      if (visualData && !visualData.passed) {
        gates.visual.passed = false
        gates.visual.issues = (visualData.violations || []).map((v) => 
          `${v.element}: ${v.issue}`
        )
      }
    }
    
    // Gate 2: Functional Rigor
    const e2eResult = await executeTool('runE2eCycle', {
      feature: 'core flow',
      healOnFailure: true,
      maxHealAttempts: 3,
    }, this.context)
    
    const e2eData = e2eResult.data as E2EResult | undefined
    if (!e2eResult.success || (e2eData && !e2eData.passed)) {
      gates.functional.passed = false
      gates.functional.issues.push('E2E tests failed after 3 heal attempts')
    }
    
    // Gate 3: Code Hygiene
    const logsResult = await executeTool('getBrowserLogs', {
      level: 'error',
      limit: 10,
    }, this.context)
    
    const logsData = logsResult.data as LogsResult | undefined
    if (logsData && logsData.logs && logsData.logs.length > 0) {
      gates.hygiene.passed = false
      gates.hygiene.issues = logsData.logs.map((l) => l.message)
    }
    
    // Gate 4: Security Scan (NEW)
    const securityResult = await this.runSecurityScan()
    if (!securityResult.passed) {
      gates.security.passed = false
      gates.security.issues = securityResult.vulnerabilities?.map((v) => 
        `[${v.severity.toUpperCase()}] ${v.type}: ${v.message}${v.file ? ` (${v.file})` : ''}`
      ) || ['Security scan detected issues']
    }
    
    return {
      passed: gates.visual.passed && gates.functional.passed && gates.hygiene.passed && gates.security.passed,
      gates,
      fixes,
    }
  }
  
  /**
   * Run security scan (Gate 4)
   * Detects: hardcoded secrets, SQL injection, npm vulnerabilities, CORS issues
   */
  private async collectSecurityScanFiles(): Promise<Array<{ filePath: string; content: string }>> {
    const collected = new Map<string, string>()

    // Include files already touched in this orchestration context first.
    for (const [filePath, content] of this.context.files) {
      if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(filePath)) {
        collected.set(filePath, content)
      }
    }

    // Also scan the on-disk project tree to avoid false-clean scans when context is sparse.
    const roots = ['src', 'app', 'lib', 'components', 'pages', 'api']
    const ignoredDirs = new Set(['node_modules', '.next', '.git', 'coverage', 'dist', 'build'])
    const maxDepth = 8
    const maxBytes = 500_000

    const walk = async (absoluteDir: string, relativeDir: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return

      let entries: Array<import('node:fs').Dirent>
      try {
        entries = await fs.readdir(absoluteDir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        const relPath = relativeDir ? path.join(relativeDir, entry.name) : entry.name
        const absPath = path.join(absoluteDir, entry.name)

        if (entry.isDirectory()) {
          if (ignoredDirs.has(entry.name)) continue
          await walk(absPath, relPath, depth + 1)
          continue
        }

        if (!entry.isFile()) continue
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(relPath)) continue
        if (collected.has(relPath)) continue

        try {
          const stats = await fs.stat(absPath)
          if (stats.size > maxBytes) continue
          const content = await fs.readFile(absPath, 'utf8')
          collected.set(relPath, content)
        } catch {
          // Skip unreadable files and continue scanning.
        }
      }
    }

    const cwd = process.cwd()
    for (const root of roots) {
      await walk(path.join(cwd, root), root, 0)
    }

    return Array.from(collected.entries()).map(([filePath, content]) => ({ filePath, content }))
  }

  private async runSecurityScan(): Promise<{
    passed: boolean
    vulnerabilities?: Array<{ type: string; severity: string; message: string; file?: string }>
  }> {
    const vulnerabilityMap = new Map<string, { type: string; severity: string; message: string; file?: string }>()

    // Pattern-based secret detection
    const secretPatterns = [
      { pattern: /['"`]sk[-_]live[-_][a-zA-Z0-9]{20,}['"`]/i, type: 'hardcoded_secret', message: 'Stripe live key detected' },
      { pattern: /['"`]AKIA[0-9A-Z]{16}['"`]/i, type: 'hardcoded_secret', message: 'AWS access key detected' },
      { pattern: /password\s*[:=]\s*['"`][^'"`]+['"`]/i, type: 'hardcoded_secret', message: 'Hardcoded password detected' },
      { pattern: /api[-_]?key\s*[:=]\s*['"`][a-zA-Z0-9]{20,}['"`]/i, type: 'hardcoded_secret', message: 'Hardcoded API key detected' },
      { pattern: /private[-_]?key\s*[:=]\s*['"`]-----BEGIN/i, type: 'hardcoded_secret', message: 'Private key in source code' },
    ]

    // SQL injection patterns
    const sqlInjectionPatterns = [
      { pattern: /\$\{[^}]+\}[\s\S]*(SELECT|INSERT|UPDATE|DELETE|DROP)/i, type: 'sql_injection', message: 'Potential SQL injection via template literal' },
      { pattern: /query\s*\(\s*['"`][^'"`]*\+/i, type: 'sql_injection', message: 'String concatenation in SQL query' },
    ]

    // CORS issues
    const corsPatterns = [
      { pattern: /Access-Control-Allow-Origin['":\s]+\*/i, type: 'cors_misconfiguration', message: 'Wildcard CORS origin detected' },
      { pattern: /credentials:\s*['"]include['"][\s\S]*origin:\s*\*/i, type: 'cors_misconfiguration', message: 'Credentials with wildcard origin' },
    ]

    const filesToScan = await this.collectSecurityScanFiles()
    if (filesToScan.length === 0) {
      vulnerabilityMap.set('scan_incomplete', {
        type: 'scan_incomplete',
        severity: 'medium',
        message: 'Security scan had no source files to inspect',
      })
    }

    for (const { filePath, content } of filesToScan) {
      const checks = [
        ...secretPatterns.map((entry) => ({ ...entry, severity: 'critical' as const })),
        ...sqlInjectionPatterns.map((entry) => ({ ...entry, severity: 'high' as const })),
        ...corsPatterns.map((entry) => ({ ...entry, severity: 'medium' as const })),
      ]

      for (const { pattern, type, severity, message } of checks) {
        if (!pattern.test(content)) continue

        const key = `${type}:${filePath}:${message}`
        if (!vulnerabilityMap.has(key)) {
          vulnerabilityMap.set(key, { type, severity, message, file: filePath })
        }
      }
    }

    const vulnerabilities = Array.from(vulnerabilityMap.values())

    return {
      passed: vulnerabilities.length === 0,
      vulnerabilities: vulnerabilities.length > 0 ? vulnerabilities : undefined,
    }
  }
  
  /**
   * ARCHITECT INTEGRITY CHECK
   * 
   * Uses Strategist (GPT-5.2) to validate Architect's file structure
   * BEFORE Backend starts building. Catches structural issues early.
   * 
   * Questions Strategist answers:
   * - Is responsibility clearly separated?
   * - Are there unnecessary abstractions?
   * - Does file layout match intent?
   * 
   * Returns: APPROVED / AMENDMENTS / REJECTED
   */
  async runArchitectIntegrityCheck(
    architectOutput: string,
    originalRequest: string,
    persistedInvariants?: string | null
  ): Promise<{
    verdict: 'APPROVED' | 'AMENDMENTS' | 'REJECTED'
    governance: GovernanceObject | null
    issues?: string[]
    amendments?: string[]
  }> {
    const checkPrompt = `
You are validating the ARCHITECT's file structure before Backend implementation begins.

═══ ORIGINAL USER REQUEST ═══
${originalRequest}

═══ ARCHITECT'S PROPOSED STRUCTURE ═══
${architectOutput}

═══ YOUR TASK ═══
Evaluate the proposed structure. Answer these questions:

1. RESPONSIBILITY SEPARATION
   - Is each file's job clear and single-purpose?
   - Are there redundant files doing the same thing?

2. ABSTRACTION LEVEL
   - Are there unnecessary abstractions for this scope?
   - Is anything over-engineered?

3. FILE LAYOUT SANITY
   - Does the structure match the user's request?
   - Are related files co-located?
   - Does it follow Next.js App Router conventions?

4. BOUNDARY CLEANLINESS
   - Are component boundaries logical?
   - Is state scoped appropriately?

OUTPUT your verdict as a JSON GovernanceObject per your system prompt.
Include protected_invariants for anything in the existing codebase that
MUST NOT be broken by this build.
${persistedInvariants ? `\n═══ PREVIOUSLY ESTABLISHED INVARIANTS ═══\nThese invariants were established in prior builds and MUST be carried forward\nunless the user explicitly asks to change them.\n\n${persistedInvariants}\n` : ''}
`

    const result = await this.executeAgent('strategist', checkPrompt, { modelTier: 'sonnet' })
    
    // Parse structured GovernanceObject from Strategist output
    const parseResult = parseGovernanceOutput(result.output)
    const gov = parseResult.governance
    
    if (!gov) {
      // Parser failed -- treat as approved with a warning
      console.warn('[Orchestrator] Failed to parse Strategist governance output:', parseResult.parseError)
      return { verdict: 'APPROVED', governance: null }
    }
    
    if (gov.verdict === 'rejected') {
      return {
        verdict: 'REJECTED',
        governance: gov,
        issues: [gov.rejection_reason || 'Structure rejected by Strategist'],
      }
    }
    
    if (gov.verdict === 'approved_with_amendments') {
      return {
        verdict: 'AMENDMENTS',
        governance: gov,
        amendments: gov.amendments && gov.amendments.length > 0 
          ? gov.amendments 
          : ['Review suggested amendments'],
      }
    }
    
    if (gov.verdict === 'escalate') {
      return {
        verdict: 'REJECTED',
        governance: gov,
        issues: [gov.escalation_reason || 'Requires human approval'],
      }
    }
    
    return { verdict: 'APPROVED', governance: gov }
  }
  
  /**
   * Full orchestration: Plan → Execute → Audit
   * Now powered by Kimi K2.5 intelligent routing!
   */
  async orchestrate(userPrompt: string, context?: { hasImages?: boolean; persistedInvariants?: string | null }): Promise<{
    plan: AgentResult
    execution: AgentResult[]
    audit: AuditResult
    routing?: RoutingDecision
    preflight?: PreflightResult
    governance?: GovernanceObject
    invariantResults?: { passed: boolean; tested: number; failed: string[] }
  }> {
    // 0. Pre-flight check: validate request before spending fuel
    const preflightResult = this.preflight(userPrompt)
    if (!preflightResult.feasible) {
      // Return early with empty results if request is unfeasible
      return {
        plan: {
          agentId: 'architect',
          success: false,
          output: `Request rejected: ${preflightResult.reason}`,
          toolCalls: [],
          duration: 0,
        },
        execution: [],
        audit: {
          passed: false,
          gates: {
            visual: { passed: false, issues: ['Pre-flight check failed'] },
            functional: { passed: false, issues: [] },
            hygiene: { passed: false, issues: [] },
            security: { passed: false, issues: [] },
          },
        },
        preflight: preflightResult,
      }
    }
    
    // 1. Create checkpoint before any work
    await executeTool('createCheckpoint', {
      name: 'pre-orchestration',
      reason: 'Before executing user request',
    }, this.context)
    
    // 2. Get routing decision using deterministic router
    const routing = this.getRoutingDecision(userPrompt, context)
    
    // 3. Plan with Architect (using routing model tier if available)
    const planModelTier = routing?.modelTier ?? 'opus'
    const plan = await this.executeAgent('architect', `
      Plan the implementation for this user request:
      "${userPrompt}"
      
      Break it down into steps and identify which agents should handle each step.
      ${routing ? `\nRouting analysis suggests: ${routing.reasoning}` : ''}
    `, { modelTier: planModelTier })
    
    // 3.5 ARCHITECT INTEGRITY CHECK - Strategist validates structure before Backend builds
    // GATED: Only runs for moderate+ complexity to avoid latency on trivial tasks
    const estimatedComplexity = preflightResult.estimatedComplexity
    const needsGovernance = ['moderate', 'complex', 'architectural'].includes(estimatedComplexity)
    let governance: GovernanceObject | null = null
    
    if (plan.success && needsGovernance) {
      const integrityCheck = await this.runArchitectIntegrityCheck(plan.output, userPrompt, context?.persistedInvariants)
      governance = integrityCheck.governance
      
      if (integrityCheck.verdict === 'REJECTED') {
        // Structure rejected - return early with clear feedback
        return {
          plan: {
            ...plan,
            success: false,
            output: `Architect structure REJECTED by Strategist: ${integrityCheck.issues?.join(', ') || 'Structure validation failed'}`,
          },
          execution: [],
          audit: {
            passed: false,
            gates: {
              visual: { passed: false, issues: ['Architect Integrity Check failed'] },
              functional: { passed: false, issues: integrityCheck.issues || [] },
              hygiene: { passed: true, issues: [] },
              security: { passed: true, issues: [] },
            },
          },
          routing: routing ?? undefined,
          preflight: preflightResult,
          governance: governance ?? undefined,
        }
      }
      
      if (integrityCheck.verdict === 'AMENDMENTS') {
        // Amendments requested - re-run Architect with feedback
        const amendedPlan = await this.executeAgent('architect', `
          Your previous plan was reviewed by the Strategist who requested these amendments:
          ${integrityCheck.amendments?.join('\n') || 'Review and improve structure'}
          
          Original request: "${userPrompt}"
          
          Please revise your plan incorporating these amendments.
        `, { modelTier: planModelTier })
        
        // Replace plan with amended version
        Object.assign(plan, amendedPlan)
      }
      // APPROVED: continue to execution
    }
    
    // 4. Execute with appropriate agent from routing decision
    const execution: AgentResult[] = []
    
    if (routing) {
      // Use deterministic routing decision
      const result = await this.executeAgent(
        routing.targetAgent,
        userPrompt,
        { modelTier: routing.modelTier }
      )
      execution.push(result)
    } else {
      // Fallback if routing fails (ambiguous path) — use architect
      const result = await this.executeAgent('architect', userPrompt)
      execution.push(result)
    }
    
    // 5. Run audit pipeline (unless explicitly disabled)
    const shouldRunAudit = this.config.enableAudit ?? true
    const audit = shouldRunAudit
      ? await this.runAuditPipeline()
      : {
          passed: true,
          gates: {
            visual: { passed: true, issues: [] as string[] },
            functional: { passed: true, issues: [] as string[] },
            hygiene: { passed: true, issues: [] as string[] },
            security: { passed: true, issues: [] as string[] },
          },
        }
    
    // 6. If audit failed and we have fixes, apply them
    //    Pass governance contract so Auditor can enforce invariants
    if (shouldRunAudit && !audit.passed) {
      const governanceContext = governance 
        ? `\n\n${formatGovernanceForAgent(governance)}` 
        : ''
      
      await this.executeAgent('auditor', `
        The following issues were detected:
        Visual: ${audit.gates.visual.issues.join(', ') || 'None'}
        Functional: ${audit.gates.functional.issues.join(', ') || 'None'}
        Hygiene: ${audit.gates.hygiene.issues.join(', ') || 'None'}
        
        Review these issues. For each protected invariant, check if it was
        violated and attempt repair before failing.${governanceContext}
      `)
    }
    
    // 7. QA INVARIANT VERIFICATION - Prove invariants with assertions
    //    Only runs when governance has hard invariants. This is the proof layer.
    let invariantResults: { passed: boolean; tested: number; failed: string[] } | undefined
    
    if (governance) {
      const qaPrompt = formatInvariantsForQA(governance)
      
      if (qaPrompt) {
        const qaResult = await this.executeAgent('qa', `
          You are running INVARIANT VERIFICATION -- not product tests.
          
          Generate and execute one Playwright test per hard invariant listed below.
          Follow the invariant-to-assertion mapping in your system prompt.
          
          ${qaPrompt}
          
          After generating each test file, run it immediately.
          Report which invariants HELD and which VIOLATED.
        `, { modelTier: 'sonnet' })
        
        // Parse QA results for invariant pass/fail
        const hardCount = governance.protected_invariants.filter(i => i.severity === 'hard').length
        const failedInvariants: string[] = []
        
        for (let i = 0; i < hardCount; i++) {
          const inv = governance.protected_invariants.filter(i => i.severity === 'hard')[i]
          // Check QA output for failure indicators on this invariant
          const outputUpper = qaResult.output.toUpperCase()
          if (outputUpper.includes(`INVARIANT.${i}`) && outputUpper.includes('FAIL')) {
            failedInvariants.push(inv.description)
          }
        }
        
        invariantResults = {
          passed: failedInvariants.length === 0,
          tested: hardCount,
          failed: failedInvariants,
        }
        
        // If invariant tests failed, mark audit as failed
        if (!invariantResults.passed) {
          audit.passed = false
          audit.gates.functional.passed = false
          audit.gates.functional.issues.push(
            ...failedInvariants.map(desc => `INVARIANT VIOLATED: ${desc}`)
          )
        }
      }
    }
    
    return { plan, execution, audit, routing: routing ?? undefined, preflight: preflightResult, governance: governance ?? undefined, invariantResults }
  }
  
  /**
   * Smart execution: Let Kimi decide which agent to use
   */
  async smartExecute(
    prompt: string,
    context?: { hasImages?: boolean }
  ): Promise<AgentResult & { routing?: RoutingDecision }> {
    const routing = this.getRoutingDecision(prompt, context)
    
    if (routing) {
      const result = await this.executeAgent(
        routing.targetAgent,
        prompt,
        { modelTier: routing.modelTier }
      )
      return { ...result, routing }
    }
    
    // Fallback: use architect with sonnet
    const result = await this.executeAgent('architect', prompt, { modelTier: 'sonnet' })
    return result
  }
  
  /**
   * Execute multiple agents in parallel for faster full-stack development
   * 
   * Use case: "Build full-stack feature" → Frontend + Backend + Database run simultaneously
   * Then Architect merges results into a cohesive system.
   * 
   * Wall-clock speedup: ~3x for 3 parallel agents (network-bound, not compute-bound)
   */
  async executeParallel(
    tasks: ParallelTask[],
    options: {
      /** If true, use Architect with Opus to merge all outputs into cohesive result */
      mergeWithArchitect?: boolean
      /** Custom merge prompt (optional) */
      mergePrompt?: string
      /** Model tier for merge step (default: opus) */
      mergeModelTier?: ModelTier
    } = {}
  ): Promise<ParallelResult> {
    const startTime = Date.now()
    
    // 1. Create checkpoint for safety (rollback if parallel execution fails)
    const checkpointResult = await executeTool('createCheckpoint', {
      name: `parallel-execution-${Date.now()}`,
      reason: `Before parallel execution of ${tasks.length} agents: ${tasks.map(t => t.agent).join(', ')}`,
    }, this.context)
    const checkpoint = (checkpointResult.data as { checkpointId?: string })?.checkpointId ?? `checkpoint-${Date.now()}`
    
    // 2. Execute all agents in parallel
    const parallelStart = Date.now()
    const settled = await Promise.allSettled(
      tasks.map(({ agent, prompt, modelTier }) =>
        this.executeAgent(agent, prompt, { modelTier: modelTier ?? 'sonnet' })
      )
    )
    const results = settled.map((entry, index) => {
      if (entry.status === 'fulfilled') return entry.value
      return {
        agentId: tasks[index]?.agent ?? 'architect',
        success: false,
        output: `Parallel execution failed: ${entry.reason instanceof Error ? entry.reason.message : 'Unknown error'}`,
        toolCalls: [],
        duration: 0,
      } satisfies AgentResult
    })
    const parallelDuration = Date.now() - parallelStart
    
    // Calculate theoretical sequential time (sum of all durations)
    const theoreticalSequentialTime = results.reduce((sum, r) => sum + r.duration, 0)
    const parallelSpeedup = theoreticalSequentialTime / parallelDuration
    
    // 3. Optionally merge results with Architect
    let merged: AgentResult | undefined
    if (options.mergeWithArchitect) {
      const mergePrompt = options.mergePrompt ?? this.buildMergePrompt(tasks, results)
      merged = await this.executeAgent('architect', mergePrompt, {
        modelTier: options.mergeModelTier ?? 'opus',
      })
    }
    
    return {
      results,
      merged,
      checkpoint,
      totalDuration: Date.now() - startTime,
      parallelSpeedup,
    }
  }
  
  /**
   * Build default merge prompt for Architect
   */
  private buildMergePrompt(tasks: ParallelTask[], results: AgentResult[]): string {
    const sections = tasks.map((task, i) => {
      const result = results[i]
      const status = result.success ? '✅' : '❌'
      return `### ${task.agent.toUpperCase()} Agent ${status}
**Task:** ${task.prompt}
**Output:**
${result.output}
**Tool calls:** ${result.toolCalls.length} (${result.toolCalls.map(tc => tc.name).join(', ') || 'none'})`
    }).join('\n\n')
    
    return `You are integrating work from ${tasks.length} parallel agents.

Review their outputs and create a cohesive, working system:

${sections}

## Your Task:
1. Identify any conflicts or inconsistencies between the outputs
2. Resolve type mismatches (e.g., frontend expecting different API shape than backend provides)
3. Create any missing integration code (API clients, shared types, imports)
4. Ensure all pieces work together as a unified feature
5. List any remaining TODOs or manual steps needed

Output a clear integration plan and any necessary code changes.`
  }
  
  /**
   * Decompose a complex task into parallel subtasks using Planner
   * Then execute them in parallel and merge with Architect
   */
  async orchestrateParallel(
    userPrompt: string,
    options?: { maxParallelAgents?: number }
  ): Promise<ParallelResult & { plan: AgentResult }> {
    // 1. Use Planner to decompose into parallelizable tasks
    const planPrompt = `Decompose this request into parallel subtasks that can be executed simultaneously.
    
User request: "${userPrompt}"

Identify which agents should handle each subtask:
- frontend: UI components, pages, styling
- backend: APIs, business logic, server code
- database: Schema design, migrations, queries
- devops: Deployment, CI/CD, infrastructure
- qa: Tests, test data, coverage

Output a JSON array of tasks:
[
  { "agent": "frontend", "prompt": "Create the dashboard UI with...", "modelTier": "sonnet" },
  { "agent": "backend", "prompt": "Build the REST API for...", "modelTier": "sonnet" }
]

Rules:
- Maximum ${options?.maxParallelAgents ?? 4} parallel tasks
- Each task should be independent (no dependencies between them)
- Use "flash" for simple tasks, "sonnet" for moderate, "opus" for complex`

    const plan = await this.executeAgent('planner', planPrompt, { modelTier: 'sonnet' })
    
    // 2. Parse tasks from planner output
    let tasks: ParallelTask[] = []
    const validAgents: AgentId[] = ['architect', 'frontend', 'backend', 'database', 'devops', 'qa', 'planner', 'auditor']
    const validModelTiers: ModelTier[] = ['opus', 'sonnet', 'flash']
    const maxParallelAgents = Math.max(1, options?.maxParallelAgents ?? 4)
    try {
      const jsonMatch = plan.output.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed)) {
          const normalizedTasks: ParallelTask[] = []
          for (const item of parsed) {
            const t = item as { agent?: string; prompt?: string; modelTier?: string }
            if (!t.agent || !validAgents.includes(t.agent as AgentId)) continue
            if (!t.prompt || typeof t.prompt !== 'string' || !t.prompt.trim()) continue

            const tier = t.modelTier && validModelTiers.includes(t.modelTier as ModelTier)
              ? (t.modelTier as ModelTier)
              : 'sonnet'

            normalizedTasks.push({
              agent: t.agent as AgentId,
              prompt: t.prompt.trim(),
              modelTier: tier,
            })
          }
          tasks = normalizedTasks.slice(0, maxParallelAgents)
        }
      }
    } catch {
      // Fallback: single agent execution if parsing fails
      console.warn('[Orchestrator] Failed to parse parallel tasks, falling back to single agent')
    }

    if (tasks.length === 0) {
      tasks = [{ agent: 'architect', prompt: userPrompt, modelTier: 'sonnet' }]
    }
    
    // 3. Execute in parallel and merge
    const parallelResult = await this.executeParallel(tasks, { mergeWithArchitect: true })
    
    return { ...parallelResult, plan }
  }
  
  /**
   * Get the current execution context (for inspection/debugging)
   */
  getContext(): ToolExecutionContext {
    return this.context
  }
  

}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Create a new orchestrator instance
 */
export function createOrchestrator(config: OrchestrationConfig): TorbitOrchestrator {
  return new TorbitOrchestrator(config)
}

/**
 * Quick single-agent execution
 */
export async function executeWithAgent(
  agentId: AgentId,
  prompt: string,
  projectId: string,
  userId: string
): Promise<AgentResult> {
  const orchestrator = new TorbitOrchestrator({ projectId, userId })
  return orchestrator.executeAgent(agentId, prompt)
}
