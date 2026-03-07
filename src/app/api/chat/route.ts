import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import { AGENT_TOOLS, type AgentId } from '@/lib/tools/definitions'
import { createOrchestrator, type AgentResult } from '@/lib/agents/orchestrator'
import { chatRateLimiter, getClientIP, rateLimitResponse } from '@/lib/rate-limit'
import { withAuth } from '@/lib/middleware/auth'
import { resolveScopedProjectId } from '@/lib/projects/project-id'
import { classifyIntent, isActionIntent, resolveIntent, type IntentMode } from '@/lib/intent/classifier'
import { runVibeAudit } from '@/lib/vibe-audit'
import { runVibeAutofix } from '@/lib/vibe-autofix'
import { makeSupervisorEvent, type SupervisorEvent } from '@/lib/supervisor/events'
import { assertEnvContract } from '@/lib/env.contract'
import { isTransientModelError } from '@/lib/supervisor/fallback'
import {
  rankConversationProviders,
  recordConversationProviderFailure,
  recordConversationProviderSuccess,
} from '@/lib/supervisor/chat-health'

import { ARCHITECT_SYSTEM_PROMPT } from '@/lib/agents/prompts/architect'
import { FRONTEND_SYSTEM_PROMPT } from '@/lib/agents/prompts/frontend'
import { BACKEND_SYSTEM_PROMPT } from '@/lib/agents/prompts/backend'
import { DEVOPS_SYSTEM_PROMPT } from '@/lib/agents/prompts/devops'
import { QA_SYSTEM_PROMPT } from '@/lib/agents/prompts/qa'
import { AUDITOR_SYSTEM_PROMPT } from '@/lib/agents/prompts/auditor'
import { PLANNER_SYSTEM_PROMPT } from '@/lib/agents/prompts/planner'
import { STRATEGIST_SYSTEM_PROMPT } from '@/lib/agents/prompts/strategist'
import { GOD_PROMPT } from '@/lib/agents/prompts/god-prompt'
import { buildTorbitBuildContract, formatWorkspaceSnapshot, type WorkspaceFileManifest } from '@/lib/agents/build-contract'

export const runtime = 'nodejs'
export const maxDuration = 120

const ChatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })).min(1),
  agentId: z.string().optional(),
  projectId: z.string().max(200).optional(),
  projectType: z.enum(['web', 'mobile']).optional(),
  capabilities: z.record(z.string(), z.unknown()).nullable().optional(),
  persistedInvariants: z.string().nullable().optional(),
  tasteProfilePrompt: z.string().max(5000).nullable().optional(),
  fileManifest: z.object({
    files: z.array(z.object({
      path: z.string().max(500),
      bytes: z.number().int().nonnegative(),
    })).max(300),
    totalFiles: z.number().int().nonnegative(),
    truncated: z.boolean().optional(),
  }).optional(),
  intentMode: z.enum(['auto', 'chat', 'action']).optional(),
})

const VALID_AGENT_IDS = Object.keys(AGENT_TOOLS) as AgentId[]
const VIBE_AUDIT_ENABLED = process.env.TORBIT_VIBE_AUDIT !== 'false'
const VIBE_AUTOFIX_MAX_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.TORBIT_VIBE_AUTOFIX_MAX_ATTEMPTS || '3', 10) || 3
)

const MAX_OUTPUT_TOKENS = 16384

type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'tool-call'; toolCall: { id: string; name: string; args: Record<string, unknown> } }
  | { type: 'tool-result'; toolResult: { id: string; success: boolean; output: string; duration: number } }
  | { type: 'proof'; proof: Array<{ label: string; status: 'verified' | 'warning' | 'failed' }> }
  | { type: 'error'; error: { type: string; message: string; retryable: boolean } }
  | { type: 'retry'; retry: { attempt: number; maxAttempts: number; retryAfterMs: number } }
  | { type: 'supervisor-event'; event: SupervisorEvent }

function getSupervisorLedgerConfig():
  | { url: string; serviceRoleKey: string }
  | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) return null
  return { url, serviceRoleKey }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value))
}

async function postToSupabaseRest(input: {
  table: string
  rows: Record<string, unknown>[]
}): Promise<{ ok: boolean; body: string }> {
  const config = getSupervisorLedgerConfig()
  if (!config) {
    return { ok: false, body: 'missing_supabase_service_config' }
  }

  const response = await fetch(`${config.url}/rest/v1/${input.table}`, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(input.rows),
  })

  const body = await response.text()
  return { ok: response.ok, body }
}

async function persistSupervisorEvent(input: {
  event: SupervisorEvent
  projectId: string | null
  userId: string
}): Promise<void> {
  const ledgerResult = isUuid(input.projectId)
    ? await postToSupabaseRest({
      table: 'supervisor_event_ledger',
      rows: [{
        run_id: input.event.run_id,
        project_id: input.projectId,
        user_id: input.userId,
        event_type: input.event.event,
        stage: input.event.stage,
        summary: input.event.summary,
        details: input.event.details,
        created_at: input.event.timestamp,
      }],
    })
    : { ok: false, body: 'non_uuid_project_scope' }

  if (ledgerResult.ok) return

  await postToSupabaseRest({
    table: 'product_events',
    rows: [{
      user_id: input.userId,
      project_id: isUuid(input.projectId) ? input.projectId : null,
      event_name: `supervisor.${input.event.event}`,
      session_id: input.event.run_id,
      event_data: {
        stage: input.event.stage,
        summary: input.event.summary,
        details: input.event.details,
      },
      occurred_at: input.event.timestamp,
    }],
  })
}

async function persistProductEvent(input: {
  userId: string
  projectId: string | null
  sessionId: string
  eventName: string
  eventData?: Record<string, unknown>
  occurredAt?: string
}): Promise<void> {
  await postToSupabaseRest({
    table: 'product_events',
    rows: [{
      user_id: input.userId,
      project_id: isUuid(input.projectId) ? input.projectId : null,
      event_name: input.eventName,
      session_id: input.sessionId,
      event_data: input.eventData || {},
      occurred_at: input.occurredAt || new Date().toISOString(),
    }],
  })
}

interface ExecutionOptions {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  agentId: AgentId
  projectId: string
  userId: string
  systemPrompt: string
  runId: string
  sendChunk: (chunk: StreamChunk) => void
  emitSupervisor: (
    event: Parameters<typeof makeSupervisorEvent>[0]['event'],
    stage: string,
    summary: string,
    details?: Record<string, unknown>
  ) => void
}

function isValidAgentId(value: string): value is AgentId {
  return VALID_AGENT_IDS.includes(value as AgentId)
}

function normalizeMessages(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>) {
  return messages
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0)
}

function getLastUserMessage(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return messages[i].content
  }
  return ''
}

function buildToolOnlyFallback(toolCalls: Array<{ name: string; args: Record<string, unknown> }>): string {
  if (toolCalls.length === 0) {
    return 'I finished the request, but I did not get a written summary back. Please retry if you want a fuller explanation.'
  }

  const mutationCalls = toolCalls.filter((toolCall) => (
    toolCall.name === 'createFile' ||
    toolCall.name === 'editFile' ||
    toolCall.name === 'applyPatch' ||
    toolCall.name === 'deleteFile'
  ))

  if (mutationCalls.length === 0) {
    return `I finished ${toolCalls.length} build step${toolCalls.length === 1 ? '' : 's'}. Check the activity log for the exact steps.`
  }

  const touchedFiles = Array.from(new Set(
    mutationCalls
      .map((toolCall) => {
        const rawPath = toolCall.args.path
        return typeof rawPath === 'string' ? rawPath.trim() : ''
      })
      .filter((filePath) => filePath.length > 0)
  ))

  if (touchedFiles.length === 0) {
    return `I made ${mutationCalls.length} file change${mutationCalls.length === 1 ? '' : 's'}.`
  }

  const preview = touchedFiles.slice(0, 3).join(', ')
  const suffix = touchedFiles.length > 3 ? ` and ${touchedFiles.length - 3} more` : ''
  return `I updated ${mutationCalls.length} file${mutationCalls.length === 1 ? '' : 's'}: ${preview}${suffix}.`
}

function createAgentPrompt(agentPrompt: string): string {
  return `${GOD_PROMPT}\n\n---\n\n## AGENT-SPECIFIC INSTRUCTIONS\n\n${agentPrompt}`
}

const AGENT_PROMPTS: Record<AgentId, string> = {
  architect: createAgentPrompt(ARCHITECT_SYSTEM_PROMPT),
  frontend: createAgentPrompt(FRONTEND_SYSTEM_PROMPT),
  backend: createAgentPrompt(BACKEND_SYSTEM_PROMPT),
  database: createAgentPrompt(BACKEND_SYSTEM_PROMPT),
  devops: createAgentPrompt(DEVOPS_SYSTEM_PROMPT),
  qa: createAgentPrompt(QA_SYSTEM_PROMPT),
  planner: createAgentPrompt(PLANNER_SYSTEM_PROMPT),
  strategist: createAgentPrompt(STRATEGIST_SYSTEM_PROMPT),
  auditor: createAgentPrompt(AUDITOR_SYSTEM_PROMPT),
}

function buildSystemPrompt(input: {
  agentId: AgentId
  userPrompt: string
  projectType?: 'web' | 'mobile'
  persistedInvariants?: string | null
  tasteProfilePrompt?: string | null
  fileManifest?: WorkspaceFileManifest
  guardrailPrompt?: string | null
}): string {
  const basePrompt = AGENT_PROMPTS[input.agentId] || AGENT_PROMPTS.architect
  const parts = [basePrompt]

  parts.push(buildTorbitBuildContract({
    userPrompt: input.userPrompt,
    projectType: input.projectType,
    fileManifest: input.fileManifest,
  }))

  if (input.persistedInvariants) {
    parts.push(input.persistedInvariants)
  }

  if (input.tasteProfilePrompt) {
    parts.push(input.tasteProfilePrompt)
  }

  if (input.fileManifest && input.fileManifest.files.length > 0) {
    parts.push(formatWorkspaceSnapshot(input.fileManifest))
  }

  if (input.guardrailPrompt) {
    parts.push(input.guardrailPrompt)
  }

  return parts.join('\n\n')
}

type ConversationModelCandidate = {
  label: string
  model: ReturnType<typeof openai> | ReturnType<typeof anthropic> | ReturnType<typeof google>
}

const DEFAULT_ANTHROPIC_SONNET_MODEL = process.env.TORBIT_ANTHROPIC_SONNET_MODEL || 'claude-sonnet-4-20250514'

function getConversationModels(): ConversationModelCandidate[] {
  const models: ConversationModelCandidate[] = []

  if (process.env.OPENAI_API_KEY) {
    models.push({ label: 'openai:gpt-5.2', model: openai('gpt-5.2') })
  }

  if (process.env.ANTHROPIC_API_KEY) {
    models.push({
      label: `anthropic:${DEFAULT_ANTHROPIC_SONNET_MODEL}`,
      model: anthropic(DEFAULT_ANTHROPIC_SONNET_MODEL),
    })
  }

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY) {
    models.push({ label: 'google:gemini-2.5-pro', model: google('gemini-2.5-pro') })
  }

  return models
}

async function runConversationReply(input: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  sendChunk: (chunk: StreamChunk) => void
  emitSupervisor: ExecutionOptions['emitSupervisor']
  userMessage: string
}) {
  const models = getConversationModels()
  if (models.length === 0) {
    input.sendChunk({
      type: 'text',
      content: buildDeterministicChatFallback(input.userMessage),
    })
    return
  }

  const systemPrompt = [
    'You are Torbit, a senior software engineer assistant.',
    'The user asked a conversational question.',
    'Respond directly and clearly in natural language.',
    'Do not trigger build or file mutation workflows.',
  ].join('\n')

  let streamedAnyText = false
  let lastError: unknown = null
  let previousFailureMessage: string | null = null

  const providerOrder = rankConversationProviders(models.map((candidate) => candidate.label))
  const modelByLabel = new Map(models.map((candidate) => [candidate.label, candidate]))

  if (providerOrder.skipped.length > 0) {
    input.emitSupervisor(
      'fallback_invoked',
      'chat',
      'Skipping unhealthy chat providers with open circuit breaker.',
      {
        intent: 'chat',
        skipped: providerOrder.skipped.map((provider) => ({
          provider: provider.label,
          cooldown_ms_remaining: provider.cooldownMsRemaining,
          last_error: provider.lastError,
        })),
      }
    )
  }

  const activeCandidates = providerOrder.active
    .map((provider) => modelByLabel.get(provider.label))
    .filter((candidate): candidate is ConversationModelCandidate => Boolean(candidate))

  for (let candidateIndex = 0; candidateIndex < activeCandidates.length; candidateIndex += 1) {
    const candidate = activeCandidates[candidateIndex]
    let candidateFailed = false

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const startedAt = Date.now()

      try {
        if (candidateIndex > 0 && attempt === 1) {
          input.emitSupervisor(
            'fallback_invoked',
            'chat',
            'Chat fallback model selected.',
            {
              intent: 'chat',
              reason: previousFailureMessage ?? 'previous model failed',
              chosen_replacement: candidate.label,
            }
          )
        } else if (attempt > 1) {
          input.emitSupervisor(
            'fallback_invoked',
            'chat',
            'Retrying the same chat model once after transient failure.',
            {
              intent: 'chat',
              reason: previousFailureMessage ?? 'transient failure',
              chosen_replacement: candidate.label,
              strategy: 'retry_once_same_model',
            }
          )
        }

        const response = await streamText({
          model: candidate.model,
          system: systemPrompt,
          messages: input.messages,
          maxOutputTokens: 4096,
        })

        for await (const part of response.fullStream) {
          if (part.type === 'text-delta') {
            streamedAnyText = true
            input.sendChunk({ type: 'text', content: part.text })
          } else if (part.type === 'error') {
            const streamError = (part as { error?: unknown }).error
            if (streamError instanceof Error) throw streamError
            if (typeof streamError === 'string') throw new Error(streamError)
            throw new Error(streamError ? JSON.stringify(streamError) : 'Conversation stream failed')
          }
        }

        recordConversationProviderSuccess(candidate.label, {
          latencyMs: Date.now() - startedAt,
        })
        return
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message : 'Conversation stream failed.'
        previousFailureMessage = message
        candidateFailed = true

        recordConversationProviderFailure(candidate.label, {
          errorMessage: message,
        })

        console.warn('[chat] conversation model failed', {
          model: candidate.label,
          attempt,
          error: message,
        })

        const shouldRetrySameModel = attempt === 1 && isTransientModelError(message)
        if (shouldRetrySameModel) {
          continue
        }

        break
      }
    }

    if (!candidateFailed) {
      return
    }
  }

  if (!streamedAnyText) {
    const lastErrorMessage = lastError instanceof Error
      ? lastError.message
      : 'Conversation providers did not return output.'
    input.emitSupervisor(
      'fallback_invoked',
      'chat',
      'Conversation providers unavailable. Returning local fallback response.',
      {
        intent: 'chat',
        reason: lastErrorMessage,
        chosen_replacement: 'local_fallback',
      }
    )
    input.sendChunk({
      type: 'text',
      content: buildDeterministicChatFallback(input.userMessage),
    })
  }
}

function buildDeterministicChatFallback(message: string): string {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('encouragement') ||
    normalized.includes('overwhelm') ||
    normalized.includes('stuck') ||
    normalized.includes('confidence')
  ) {
    return [
      'You are not behind. Keep the scope small and finish one concrete step first.',
      '',
      'Try this right now:',
      '1. Define one outcome for the next 30 minutes.',
      '2. Implement only that slice.',
      '3. Run one quick verification (lint/test/build) and stop.',
      '',
      'If you want, share what you are building and I will break it into the smallest shippable steps.',
    ].join('\n')
  }

  return 'I hit a temporary model issue, but I can still help. Send your question again or share the exact task and I will answer directly.'
}

function sanitizeLastUserMessage(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) {
  if (messages.length === 0) return messages
  const lastMessage = messages[messages.length - 1]
  if (lastMessage.role !== 'user') return messages

  const sanitized = lastMessage.content
    .replace(/<\/user_request>/gi, '&lt;/user_request&gt;')
    .replace(/<user_request>/gi, '&lt;user_request&gt;')

  return [
    ...messages.slice(0, -1),
    {
      ...lastMessage,
      content: `<user_request>\n${sanitized}\n</user_request>`,
    },
  ]
}

async function executeActionFlow(input: ExecutionOptions): Promise<AgentResult> {
  const seenToolCalls = new Set<string>()

  const runExecution = async (mode: 'primary' | 'fallback'): Promise<AgentResult> => {
    const orchestrator = createOrchestrator({
      projectId: input.projectId,
      userId: input.userId,
    })

    const options = {
      maxSteps: mode === 'primary' ? 15 : 10,
      maxTokens: MAX_OUTPUT_TOKENS,
      systemPrompt: input.systemPrompt,
      messages: input.messages,
      onTextDelta: (delta: string) => {
        input.sendChunk({ type: 'text', content: delta })
      },
      onToolCall: (toolCall: { id: string; name: string; args: Record<string, unknown> }) => {
        if (seenToolCalls.has(toolCall.id)) return
        seenToolCalls.add(toolCall.id)
        input.sendChunk({ type: 'tool-call', toolCall })
      },
      onToolResult: (toolResult: { id: string; name: string; result: unknown; duration: number }) => {
        const output = typeof toolResult.result === 'string'
          ? toolResult.result
          : JSON.stringify(toolResult.result)

        input.sendChunk({
          type: 'tool-result',
          toolResult: {
            id: toolResult.id,
            success: !output.startsWith('Error:'),
            output,
            duration: toolResult.duration,
          },
        })
      },
    }

    if (mode === 'primary') {
      return orchestrator.executeWorldClassFlow(input.agentId, getLastUserMessage(input.messages), options)
    }

    return orchestrator.executeAgent(input.agentId, getLastUserMessage(input.messages), {
      modelRole: 'worker',
      modelTier: 'sonnet',
      maxSteps: options.maxSteps,
      maxTokens: options.maxTokens,
      messages: options.messages,
      systemPrompt: options.systemPrompt,
      onTextDelta: options.onTextDelta,
      onToolCall: options.onToolCall,
      onToolResult: options.onToolResult,
    })
  }

  input.emitSupervisor('gate_started', 'execution', 'Execution gate started.', { attempt: 1, mode: 'primary' })
  const firstAttempt = await runExecution('primary')
  if (firstAttempt.success) {
    input.emitSupervisor('gate_passed', 'execution', 'Execution gate passed.', {
      attempt: 1,
      mode: 'primary',
      tool_calls: firstAttempt.toolCalls.length,
    })
    return firstAttempt
  }

  const firstError = firstAttempt.output || 'Primary execution failed.'
  input.emitSupervisor('gate_failed', 'execution', 'Execution gate failed.', {
    attempt: 1,
    mode: 'primary',
    error: firstError,
  })

  if (!isTransientModelError(firstError)) {
    return firstAttempt
  }

  input.emitSupervisor('fallback_invoked', 'execution', 'Transient failure detected, retrying once.', {
    reason: firstError,
    strategy: 'retry_once_same_model_chain',
  })

  input.sendChunk({
    type: 'retry',
    retry: {
      attempt: 1,
      maxAttempts: 3,
      retryAfterMs: 1000,
    },
  })

  await new Promise((resolve) => setTimeout(resolve, 1000))

  input.emitSupervisor('gate_started', 'execution', 'Execution retry started.', { attempt: 2, mode: 'primary' })
  const secondAttempt = await runExecution('primary')
  if (secondAttempt.success) {
    input.emitSupervisor('gate_passed', 'execution', 'Execution retry passed.', {
      attempt: 2,
      mode: 'primary',
      tool_calls: secondAttempt.toolCalls.length,
    })
    return secondAttempt
  }

  const secondError = secondAttempt.output || 'Retry execution failed.'
  input.emitSupervisor('gate_failed', 'execution', 'Execution retry failed.', {
    attempt: 2,
    mode: 'primary',
    error: secondError,
  })

  if (!isTransientModelError(secondError)) {
    return secondAttempt
  }

  input.emitSupervisor('fallback_invoked', 'execution', 'Switching to fallback builder model chain.', {
    reason: secondError,
    chosen_replacement: DEFAULT_ANTHROPIC_SONNET_MODEL,
    strategy: 'fallback_worker_chain',
  })

  input.emitSupervisor('gate_started', 'execution', 'Fallback execution started.', { attempt: 3, mode: 'fallback' })
  const thirdAttempt = await runExecution('fallback')

  if (thirdAttempt.success) {
    input.emitSupervisor('gate_passed', 'execution', 'Fallback execution passed.', {
      attempt: 3,
      mode: 'fallback',
      tool_calls: thirdAttempt.toolCalls.length,
    })
    return thirdAttempt
  }

  input.emitSupervisor('gate_failed', 'execution', 'Fallback execution failed.', {
    attempt: 3,
    mode: 'fallback',
    error: thirdAttempt.output || 'Fallback execution failed.',
  })

  return thirdAttempt
}

const authedChatHandler = withAuth(async (req, { user }) => {

  let parsedBody: z.infer<typeof ChatRequestSchema>
  try {
    const body = await req.json()
    const parsed = ChatRequestSchema.safeParse(body)

    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          error: 'Invalid request',
          details: parsed.error.flatten().fieldErrors,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    parsedBody = parsed.data
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON payload.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const normalizedMessages = normalizeMessages(parsedBody.messages)
  if (normalizedMessages.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No valid messages provided.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const requestedAgentId = parsedBody.agentId ?? 'architect'
  if (!isValidAgentId(requestedAgentId)) {
    return new Response(
      JSON.stringify({ error: `Unknown agent: ${requestedAgentId}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const projectScopeId = resolveScopedProjectId(user.id, parsedBody.projectId)
  const persistedProjectId = isUuid(parsedBody.projectId) ? parsedBody.projectId : null
  const runId = randomUUID()
  const userPrompt = getLastUserMessage(normalizedMessages)
  const classifiedIntent = classifyIntent(userPrompt)
  const intentMode: IntentMode = parsedBody.intentMode || 'auto'
  const intent = resolveIntent(userPrompt, intentMode)
  const actionIntent = isActionIntent(intent)

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let closed = false
      let emittedText = false
      let metricsFinalized = false
      const requestStartedAt = Date.now()

      const sendChunk = (chunk: StreamChunk) => {
        if (chunk.type === 'text' && chunk.content && chunk.content.length > 0) {
          emittedText = true
        }
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        } catch {
          closed = true
        }
      }

      const close = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // no-op
        }
      }

      const recordProductEvent = (eventName: string, eventData: Record<string, unknown> = {}) => {
        void persistProductEvent({
          userId: user.id,
          projectId: persistedProjectId,
          sessionId: runId,
          eventName,
          eventData,
        }).catch((productEventError) => {
          console.warn('[metrics] Failed to persist product event', {
            run_id: runId,
            event_name: eventName,
            error: productEventError instanceof Error ? productEventError.message : 'unknown',
          })
        })
      }

      const finalizeMetrics = (input: {
        success: boolean
        outcome: 'chat' | 'action' | 'aborted'
        failureType?: 'execution' | 'transient' | 'unknown'
      }) => {
        if (metricsFinalized) return
        metricsFinalized = true

        const elapsedMs = Date.now() - requestStartedAt

        recordProductEvent('chat.reply_latency', {
          elapsedMs,
          success: input.success,
          intent,
          action: actionIntent,
          outcome: input.outcome,
        })

        if (!emittedText) {
          recordProductEvent('chat.no_reply', {
            intent,
            action: actionIntent,
            outcome: input.outcome,
            failureType: input.failureType || null,
          })
        }
      }

      const emitSupervisor = (
        event: Parameters<typeof makeSupervisorEvent>[0]['event'],
        stage: string,
        summary: string,
        details: Record<string, unknown> = {}
      ) => {
        const payload = makeSupervisorEvent({
          event,
          runId,
          stage,
          summary,
          details,
        })

        sendChunk({ type: 'supervisor-event', event: payload })

        const logLine = {
          level: event === 'gate_failed' || event === 'autofix_failed' ? 'warn' : 'info',
          event,
          run_id: runId,
          project_id: projectScopeId,
          user_id: user.id,
          stage,
          summary,
          details,
          timestamp: payload.timestamp,
        }

        if (event === 'gate_failed' || event === 'autofix_failed') {
          console.warn('[supervisor]', logLine)
        } else {
          console.log('[supervisor]', logLine)
        }

        void persistSupervisorEvent({
          event: payload,
          projectId: persistedProjectId,
          userId: user.id,
        }).catch((ledgerError) => {
          console.warn('[supervisor] Failed to persist ledger event', {
            run_id: runId,
            event,
            error: ledgerError instanceof Error ? ledgerError.message : 'unknown',
          })
        })
      }

      try {
        recordProductEvent('chat.requested', {
          intent,
          classified_intent: classifiedIntent,
          intent_mode: intentMode,
          action: actionIntent,
        })

        if (!actionIntent) {
          emitSupervisor('intent_classified', 'routing', 'Intent classified.', {
            intent,
            classified_intent: classifiedIntent,
            intent_mode: intentMode,
            action: false,
          })

          await runConversationReply({
            messages: sanitizeLastUserMessage(normalizedMessages),
            sendChunk,
            emitSupervisor,
            userMessage: userPrompt,
          })
          finalizeMetrics({
            success: true,
            outcome: 'chat',
          })
          close()
          return
        }

        emitSupervisor('run_started', 'run', 'Action run started.', {
          intent,
          classified_intent: classifiedIntent,
          intent_mode: intentMode,
          agent_id: requestedAgentId,
        })

        emitSupervisor('intent_classified', 'routing', 'Intent classified.', {
          intent,
          classified_intent: classifiedIntent,
          intent_mode: intentMode,
          action: true,
        })

        emitSupervisor('route_selected', 'routing', 'Route selected for actionable intent.', {
          route: 'world_class_orchestration',
          context: 'workspace-aware execution brief',
          supervision: 'risk-aware run control',
          builder: 'implementation worker chain',
          verification: 'quality gate and cleanup pass',
        })

        let guardrailPrompt = ''

        if (VIBE_AUDIT_ENABLED) {
          emitSupervisor('gate_started', 'vibe_audit', 'Vibe safety audit started.')
          const projectRoot = process.cwd()
          let auditReport = await runVibeAudit(projectRoot)

          const sendProof = () => {
            if (auditReport.proof.length > 0) {
              sendChunk({ type: 'proof', proof: auditReport.proof })
            }
          }

          sendProof()

          let unresolvedFindings = auditReport.findings.filter((finding) => finding.status !== 'verified')
          guardrailPrompt = auditReport.guardrailPrompt

          if (unresolvedFindings.length === 0) {
            emitSupervisor('gate_passed', 'vibe_audit', 'Vibe safety audit passed.')
          } else {
            emitSupervisor('gate_failed', 'vibe_audit', 'Vibe safety audit reported violations.', {
              count: unresolvedFindings.length,
              findings: unresolvedFindings.map((finding) => finding.label),
            })

            for (
              let attempt = 1;
              attempt <= VIBE_AUTOFIX_MAX_ATTEMPTS && unresolvedFindings.length > 0;
              attempt += 1
            ) {
              const previousSignature = unresolvedFindings
                .map((finding) => `${finding.id}:${finding.detail}`)
                .sort()
                .join('|')

              emitSupervisor('autofix_started', 'vibe_audit', 'Auto-fix pass started.', {
                attempt,
                maxAttempts: VIBE_AUTOFIX_MAX_ATTEMPTS,
                findings: unresolvedFindings.map((finding) => finding.id),
              })

              const autofixResult = await runVibeAutofix(projectRoot, auditReport)
              if (autofixResult.applied.length > 0) {
                emitSupervisor('autofix_succeeded', 'vibe_audit', 'Auto-fix pass applied changes.', {
                  attempt,
                  maxAttempts: VIBE_AUTOFIX_MAX_ATTEMPTS,
                  applied: autofixResult.applied,
                  skipped: autofixResult.skipped,
                })
              } else {
                emitSupervisor('autofix_failed', 'vibe_audit', 'Auto-fix could not apply changes.', {
                  attempt,
                  maxAttempts: VIBE_AUTOFIX_MAX_ATTEMPTS,
                  skipped: autofixResult.skipped,
                })
              }

              auditReport = await runVibeAudit(projectRoot)
              guardrailPrompt = auditReport.guardrailPrompt
              sendProof()

              const remainingFindings = auditReport.findings.filter((finding) => finding.status !== 'verified')
              if (remainingFindings.length === 0) {
                emitSupervisor(
                  'gate_passed',
                  'vibe_audit',
                  `Vibe safety audit passed after auto-fix attempt ${attempt}.`
                )
                unresolvedFindings = remainingFindings
                break
              }

              const nextSignature = remainingFindings
                .map((finding) => `${finding.id}:${finding.detail}`)
                .sort()
                .join('|')
              const progressed = (
                remainingFindings.length < unresolvedFindings.length ||
                nextSignature !== previousSignature
              )

              unresolvedFindings = remainingFindings

              if (!progressed) {
                emitSupervisor(
                  'gate_failed',
                  'vibe_audit',
                  'Vibe safety audit still has violations with no additional auto-fix progress.',
                  {
                    attempt,
                    maxAttempts: VIBE_AUTOFIX_MAX_ATTEMPTS,
                    count: unresolvedFindings.length,
                    findings: unresolvedFindings.map((finding) => finding.label),
                  }
                )
                break
              }

              if (attempt === VIBE_AUTOFIX_MAX_ATTEMPTS) {
                emitSupervisor(
                  'gate_failed',
                  'vibe_audit',
                  'Vibe safety audit still has violations after max auto-fix attempts.',
                  {
                    attempt,
                    maxAttempts: VIBE_AUTOFIX_MAX_ATTEMPTS,
                    count: unresolvedFindings.length,
                    findings: unresolvedFindings.map((finding) => finding.label),
                  }
                )
              }
            }
          }
        }

        emitSupervisor('gate_started', 'brief', 'Preparing the build brief and project context.', {
          file_count: parsedBody.fileManifest?.totalFiles ?? 0,
          has_taste_profile: Boolean(parsedBody.tasteProfilePrompt),
          has_persisted_invariants: Boolean(parsedBody.persistedInvariants),
        })

        const systemPrompt = buildSystemPrompt({
          agentId: requestedAgentId,
          userPrompt,
          projectType: parsedBody.projectType,
          persistedInvariants: parsedBody.persistedInvariants,
          tasteProfilePrompt: parsedBody.tasteProfilePrompt,
          fileManifest: parsedBody.fileManifest,
          guardrailPrompt,
        })

        emitSupervisor('gate_passed', 'brief', 'Build brief ready. Handing off to the builder.', {
          file_count: parsedBody.fileManifest?.totalFiles ?? 0,
          has_guardrails: guardrailPrompt.length > 0,
        })

        const executionResult = await executeActionFlow({
          messages: sanitizeLastUserMessage(normalizedMessages),
          agentId: requestedAgentId,
          projectId: projectScopeId,
          userId: user.id,
          systemPrompt,
          runId,
          sendChunk,
          emitSupervisor,
        })

        if (!executionResult.success) {
          const failureMessage = executionResult.output || 'Execution failed.'
          sendChunk({
            type: 'error',
            error: {
              type: isTransientModelError(failureMessage) ? 'transient' : 'execution',
              message: failureMessage,
              retryable: isTransientModelError(failureMessage),
            },
          })

          emitSupervisor('run_completed', 'run', 'Action run completed with failure.', {
            success: false,
            error: failureMessage,
          })
          finalizeMetrics({
            success: false,
            outcome: 'action',
            failureType: isTransientModelError(failureMessage) ? 'transient' : 'execution',
          })
          close()
          return
        }

        if (!executionResult.output.trim()) {
          sendChunk({
            type: 'text',
            content: buildToolOnlyFallback(
              executionResult.toolCalls.map((toolCall) => ({
                name: toolCall.name,
                args: toolCall.args,
              }))
            ),
          })
        }

        emitSupervisor('run_completed', 'run', 'Action run completed successfully.', {
          success: true,
          tool_calls: executionResult.toolCalls.length,
          duration_ms: executionResult.duration,
        })

        finalizeMetrics({
          success: true,
          outcome: 'action',
        })
        close()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to process request.'
        sendChunk({
          type: 'error',
          error: {
            type: 'unknown',
            message,
            retryable: isTransientModelError(message),
          },
        })

        emitSupervisor('run_completed', 'run', 'Run aborted due to unexpected error.', {
          success: false,
          error: message,
        })

        finalizeMetrics({
          success: false,
          outcome: 'aborted',
          failureType: isTransientModelError(message) ? 'transient' : 'unknown',
        })
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
})

export async function POST(req: Request) {
  assertEnvContract('server')

  const clientIP = getClientIP(req)
  const rateLimitResult = await chatRateLimiter.check(clientIP)
  if (!rateLimitResult.success) {
    return rateLimitResponse(rateLimitResult)
  }

  return authedChatHandler(req)
}
