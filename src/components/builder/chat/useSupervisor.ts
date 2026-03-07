import { useState, useCallback, useEffect, useRef } from 'react'
import { useTasteProfileStore } from '@/store/tasteProfile'
import { getSupabase } from '@/lib/supabase/client'
import { recordMetric } from '@/lib/metrics/success'
import { error as logError } from '@/lib/observability/logger.client'
import { formatSupervisorEventLine } from '@/lib/supervisor/events'
import { getInlineSupervisorStatus } from './supervisorStatus'
import {
  formatBuildFailureSummary,
  type BuildFailure,
} from '@/lib/runtime/build-diagnostics'
import type { SupervisorReviewResult } from './SupervisorSlidePanel'
import type { Message, AgentId } from './types'
import type { RunStatus } from './ExecutionStatusRail'
import type { SupervisorEvent, RunDiagnosticsState } from './useStreamChat'

export interface PendingVerification {
  reviewMessageId: string
  originalPrompt: string
  filesCreated: string[]
  componentNames: (string | undefined)[]
  pageNames: string[]
  fileCount: number
}

interface UseSupervisorDeps {
  projectId: string | null
  selectedAgent: AgentId
  isLoading: boolean
  messages: Message[]
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setRunStatus: React.Dispatch<React.SetStateAction<RunStatus>>
  setRunStatusDetail: React.Dispatch<React.SetStateAction<string>>
  setRunDiagnostics: React.Dispatch<React.SetStateAction<RunDiagnosticsState>>
  handleSubmitMessage: (content: string, agentId: AgentId, isHealRequest?: boolean) => Promise<void>
  serverUrl: string | null
  error: string | null
  buildFailure: BuildFailure | null
  files: import('@/store/builder').ProjectFile[]
  pendingHealRequest: { error: string; suggestion: string } | null
  setPendingHealRequest: (request: { error: string; suggestion: string } | null) => void
}

export function useSupervisor(deps: UseSupervisorDeps) {
  const {
    projectId,
    selectedAgent,
    isLoading,
    setMessages,
    setRunStatus,
    setRunStatusDetail,
    setRunDiagnostics,
    handleSubmitMessage,
    serverUrl,
    error,
    buildFailure,
    files,
    pendingHealRequest,
    setPendingHealRequest,
  } = deps

  const [showSupervisor, setShowSupervisor] = useState(false)
  const [supervisorLoading, setSupervisorLoading] = useState(false)
  const [supervisorResult, setSupervisorResult] = useState<SupervisorReviewResult | null>(null)
  const [supervisorLiveLines, setSupervisorLiveLines] = useState<string[]>([])
  const [pendingVerification, setPendingVerification] = useState<PendingVerification | null>(null)

  const healAttemptCountRef = useRef(0)
  const MAX_HEAL_ATTEMPTS = 2

  const appendInlineStatus = useCallback((line: string | null) => {
    if (!line) return

    setMessages((previous) => {
      const next = [...previous]
      const targetIndex = [...next].reverse().findIndex((message) => message.role === 'assistant')
      if (targetIndex === -1) return previous

      const resolvedIndex = next.length - 1 - targetIndex
      const target = next[resolvedIndex]
      const existing = target.statusLines || []
      if (existing[existing.length - 1] === line) return previous

      next[resolvedIndex] = {
        ...target,
        statusLines: [...existing, line].slice(-6),
      }
      return next
    })
  }, [setMessages])

  const handleSupervisorEvent = useCallback((event: SupervisorEvent) => {
    const intent = typeof event.details.intent === 'string'
      ? event.details.intent
      : (typeof event.details.classified_intent === 'string' ? event.details.classified_intent : null)
    const isActionRun = intent ? intent !== 'chat' : true
    const updateDiagnostics = (next: Partial<RunDiagnosticsState>) => {
      setRunDiagnostics((previous) => ({
        ...previous,
        runId: event.run_id,
        intent: intent || previous.intent,
        updatedAt: event.timestamp,
        ...next,
      }))
    }

    if (isActionRun) {
      const line = formatSupervisorEventLine(event)
      setSupervisorLiveLines((previous) => {
        if (previous[previous.length - 1] === line) return previous
        return [...previous, line]
      })
      appendInlineStatus(getInlineSupervisorStatus(event))
    }

    if (event.event === 'run_started') {
      setRunStatus('Thinking')
      setRunStatusDetail(event.summary)
      updateDiagnostics({
        lastErrorClass: null,
        recoveryAction: 'Run started. Monitoring execution gates.',
        fallbackCount: 0,
        gateFailures: 0,
      })
      return
    }

    if (event.event === 'route_selected' || event.event === 'gate_started') {
      const stage = event.stage.toLowerCase()
      if (stage.includes('execution') || stage.includes('gate')) {
        setRunStatus('Working')
      } else {
        setRunStatus('Reviewing')
      }
      setRunStatusDetail(event.summary)
      return
    }

    if (event.event === 'autofix_started') {
      setRunStatus('Reviewing')
      setRunStatusDetail(event.summary)
      updateDiagnostics({
        recoveryAction: 'Automatic remediation is active.',
      })
      return
    }

    if (event.event === 'gate_failed' || event.event === 'autofix_failed') {
      setRunStatus('Needs Input')
      setRunStatusDetail(event.summary)
      const errorText = typeof event.details.error === 'string' ? event.details.error.toLowerCase() : ''
      const classifiedError = errorText.includes('timeout') || errorText.includes('rate limit')
        ? 'transient_provider_failure'
        : 'gate_failure'
      setRunDiagnostics((previous) => ({
        ...previous,
        runId: event.run_id,
        intent: intent || previous.intent,
        updatedAt: event.timestamp,
        lastErrorClass: classifiedError,
        gateFailures: previous.gateFailures + 1,
        recoveryAction: 'Inspect the first failed gate and re-run with the recommended fix.',
      }))
      return
    }

    if (event.event === 'fallback_invoked') {
      setRunStatus('Working')
      setRunStatusDetail(event.summary)
      const chosenReplacement = typeof event.details.chosen_replacement === 'string'
        ? event.details.chosen_replacement
        : 'alternate provider'
      setRunDiagnostics((previous) => ({
        ...previous,
        runId: event.run_id,
        intent: intent || previous.intent,
        updatedAt: event.timestamp,
        fallbackCount: previous.fallbackCount + 1,
        recoveryAction: `Fallback active: switched to ${chosenReplacement}.`,
      }))
      return
    }

    if (event.event === 'run_completed') {
      const success = event.details.success !== false
      if (isActionRun) {
        useTasteProfileStore.getState().recordRunOutcome(projectId, success)
      }
      setRunStatus(success ? 'Ready' : 'Needs Input')
      setRunStatusDetail(event.summary)
      setSupervisorLoading(false)
      setRunDiagnostics((previous) => ({
        ...previous,
        runId: event.run_id,
        intent: intent || previous.intent,
        updatedAt: event.timestamp,
        recoveryAction: success
          ? 'Run completed successfully.'
          : 'Run ended with failures. Review errors and retry.',
        lastErrorClass: success ? null : (previous.lastErrorClass || 'run_failure'),
      }))

      if (success) {
        setTimeout(() => {
          setShowSupervisor(false)
        }, 2000)
      }
      return
    }

    if (event.event === 'gate_passed' || event.event === 'autofix_succeeded') {
      setRunStatus('Reviewing')
      setRunStatusDetail(event.summary)
      updateDiagnostics({
        recoveryAction: 'Quality checks are passing. Finalizing run.',
      })
    }
  }, [appendInlineStatus, projectId, setRunStatus, setRunStatusDetail, setRunDiagnostics])

  const autoApplyFixes = useCallback((result: SupervisorReviewResult) => {
    if (!result || result.fixes.length === 0) return
    setSupervisorLiveLines(prev => [...prev, 'Supervisor initiated automatic remediation.'])

    setSupervisorResult(prev => prev ? {
      ...prev,
      fixes: prev.fixes.map(f => ({ ...f, status: 'fixing' as const }))
    } : null)

    const criticalFixes = result.fixes.filter(f => f.severity === 'critical')
    const recommendedFixes = result.fixes.filter(f => f.severity === 'recommended')

    const fixPrompt = `Supervisor review found issues. Fix these:

${criticalFixes.map((f, i) => `${i + 1}. **${f.feature}**: ${f.description}`).join('\n')}
${recommendedFixes.length > 0 ? `\nAlso add:\n${recommendedFixes.map((f, i) => `${criticalFixes.length + i + 1}. ${f.feature}: ${f.description}`).join('\n')}` : ''}

Implement these fixes in the existing codebase. Use editFile for existing files, createFile only for new files.`

    setMessages(prev => [...prev, {
      id: `supervisor-request-${Date.now()}`,
      role: 'user',
      content: `**Supervisor Request:**\n\n${criticalFixes.map((f, i) => `${i + 1}. **${f.feature}**: ${f.description}`).join('\n')}${recommendedFixes.length > 0 ? `\n\n**Also recommended:**\n${recommendedFixes.map((f) => `- ${f.feature}: ${f.description}`).join('\n')}` : ''}`,
      agentId: selectedAgent,
    }])

    const updateFixStatus = (index: number) => {
      setTimeout(() => {
        setSupervisorResult(prev => {
          if (!prev) return null
          const newFixes = [...prev.fixes]
          if (newFixes[index]) {
            newFixes[index] = { ...newFixes[index], status: 'complete' }
            setSupervisorLiveLines(prev => [...prev, `Applied fix: ${newFixes[index].feature}`])
          }
          const allComplete = newFixes.every(f => f.status === 'complete')
          if (allComplete) {
            setTimeout(() => setShowSupervisor(false), 1000)
          }
          return { ...prev, fixes: newFixes }
        })
        if (index < (result?.fixes.length || 0) - 1) {
          updateFixStatus(index + 1)
        }
      }, 1500 + (index * 800))
    }
    updateFixStatus(0)

    handleSubmitMessage(fixPrompt, selectedAgent, true)
  }, [selectedAgent, handleSubmitMessage, setMessages])

  // Auto-heal effect
  useEffect(() => {
    if (!pendingHealRequest || isLoading) return

    setPendingHealRequest(null)

    healAttemptCountRef.current += 1
    const attemptNum = healAttemptCountRef.current

    if (attemptNum > MAX_HEAL_ATTEMPTS) {
      recordMetric('manual_rescue_required', {
        reason: 'auto_heal_escalation',
        attempts: attemptNum,
        error: pendingHealRequest.error,
      })

      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('torbit_manual_rescue_count', String(attemptNum))
      }

      setMessages(prev => [...prev, {
        id: `escalate-${Date.now()}`,
        role: 'assistant',
        content: `I've tried ${MAX_HEAL_ATTEMPTS} times but the issue persists. Let me call in the supervisor for a deeper review...`,
        agentId: selectedAgent,
        toolCalls: [],
      }])

      setShowSupervisor(true)
      setSupervisorLoading(true)

      setTimeout(async () => {
        try {
          const headers: HeadersInit = { 'Content-Type': 'application/json' }
          const supabase = getSupabase()
          if (supabase) {
            const { data: { session } } = await supabase.auth.getSession()
            if (session?.access_token) {
              headers.Authorization = `Bearer ${session.access_token}`
            }
          }

          const verifyResponse = await fetch('/api/verify', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              originalPrompt: `FIX REQUIRED: ${pendingHealRequest.error}\n\nSuggestion: ${pendingHealRequest.suggestion}`,
              filesCreated: files.map(f => f.path),
              componentNames: [],
              pageNames: [],
              fileCount: files.length,
            }),
          })

          if (verifyResponse.ok) {
            const result = await verifyResponse.json() as SupervisorReviewResult
            setSupervisorLoading(false)
            setSupervisorResult({
              status: 'NEEDS_FIXES',
              summary: `Build error after ${MAX_HEAL_ATTEMPTS} attempts: ${pendingHealRequest.error}`,
              fixes: result.fixes.length > 0 ? result.fixes : [{
                id: 'error-fix-1',
                feature: 'Fix build error',
                description: pendingHealRequest.suggestion,
                severity: 'critical',
                status: 'pending',
              }],
            })
          } else {
            setSupervisorLoading(false)
            setSupervisorResult({
              status: 'NEEDS_FIXES',
              summary: `Build error: ${pendingHealRequest.error}`,
              fixes: [{
                id: 'error-fix-1',
                feature: 'Fix build error',
                description: pendingHealRequest.suggestion,
                severity: 'critical',
                status: 'pending',
              }],
            })
          }
        } catch (err) {
          logError('builder.chat.supervisor_call_failed', {
            message: err instanceof Error ? err.message : String(err),
          })
          setSupervisorLoading(false)
          setShowSupervisor(false)
        }
      }, 300)

      return
    }

    const targetAgent: AgentId = 'architect'

    const healPrompt = `BUILD ERROR (Attempt ${attemptNum}/${MAX_HEAL_ATTEMPTS}) - Fix needed:

**Error Type:** ${pendingHealRequest.error.split(':')[0] || 'Unknown'}
**Details:** ${pendingHealRequest.error}
**Suggested Fix:** ${pendingHealRequest.suggestion}

Analyze the error, identify the problematic file, and use editFile to fix it immediately.`

    setMessages(prev => [...prev, {
      id: `heal-${Date.now()}`,
      role: 'user',
      content: healPrompt
    }])

    handleSubmitMessage(healPrompt, targetAgent, true)
  }, [pendingHealRequest, isLoading, setPendingHealRequest, handleSubmitMessage, files, selectedAgent, setMessages])

  // Reset heal counter when build succeeds
  useEffect(() => {
    if (serverUrl) {
      healAttemptCountRef.current = 0
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem('torbit_manual_rescue_count')
      }
    }
  }, [serverUrl])

  // Build failure replaces optimistic message
  useEffect(() => {
    if (!error || !pendingVerification) return

    const fallbackFailure: BuildFailure = {
      category: 'unknown',
      stage: 'unknown',
      command: null,
      message: error,
      exactLogLine: error,
      actionableFix: 'Open the runtime log, fix the first failing command, and retry the build.',
      autoRecoveryAttempted: false,
      autoRecoverySucceeded: null,
    }

    const failureSummary = formatBuildFailureSummary({
      goal: 'Build and verify the live preview runtime',
      fileCount: pendingVerification.fileCount,
      failure: buildFailure || fallbackFailure,
    })

    setMessages((prev) => prev.map((message) =>
      message.id === pendingVerification.reviewMessageId
        ? { ...message, content: failureSummary }
        : message
    ))

    setSupervisorLoading(false)
    setShowSupervisor(false)
    setSupervisorLiveLines([])
    setPendingVerification(null)
  }, [error, pendingVerification, buildFailure, setMessages])

  // Trigger supervisor verification when serverUrl becomes available
  useEffect(() => {
    if (!serverUrl || !pendingVerification) return

    setMessages(prev => prev.map(m =>
      m.id === pendingVerification.reviewMessageId
        ? {
          ...m,
          content: 'Preview is live. Supervisor is now reviewing quality and completeness in real time...',
        }
        : m
    ))

    setShowSupervisor(true)
    setSupervisorLoading(true)
    setSupervisorResult(null)
    setSupervisorLiveLines([])

    const runVerification = async () => {
      try {
        const headers: HeadersInit = { 'Content-Type': 'application/json' }
        const supabase = getSupabase()
        if (supabase) {
          const { data: { session } } = await supabase.auth.getSession()
          if (session?.access_token) {
            headers.Authorization = `Bearer ${session.access_token}`
          }
        }

        const verifyResponse = await fetch('/api/verify?stream=1', {
          method: 'POST',
          headers: {
            ...headers,
            Accept: 'text/event-stream',
          },
          body: JSON.stringify(pendingVerification),
        })

        const appendSupervisorLine = (line: string) => {
          setSupervisorLiveLines(prev => {
            if (prev[prev.length - 1] === line) return prev
            return [...prev, line]
          })
        }

        if (!verifyResponse.ok) {
          throw new Error('Supervisor verification failed')
        }

        type SupervisorStreamChunk = {
          type: 'supervisor-progress' | 'supervisor-result' | 'error'
          content?: string
          error?: string
          result?: SupervisorReviewResult
        }

        let result: SupervisorReviewResult | null = null
        const streamContentType = verifyResponse.headers.get('content-type') || ''

        if (streamContentType.includes('text/event-stream')) {
          const reader = verifyResponse.body?.getReader()
          if (!reader) throw new Error('Supervisor stream unavailable')

          const decoder = new TextDecoder()
          let buffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const blocks = buffer.split('\n\n')
            buffer = blocks.pop() || ''

            for (const block of blocks) {
              if (!block.startsWith('data: ')) continue
              const chunk = JSON.parse(block.slice(6)) as SupervisorStreamChunk
              if (chunk.type === 'supervisor-progress' && chunk.content) {
                appendSupervisorLine(chunk.content)
              } else if (chunk.type === 'supervisor-result' && chunk.result) {
                result = chunk.result
              } else if (chunk.type === 'error') {
                throw new Error(chunk.error || 'Supervisor stream failed')
              }
            }
          }
        } else {
          result = await verifyResponse.json() as SupervisorReviewResult
        }

        if (!result) {
          throw new Error('Supervisor result missing')
        }

        setSupervisorLoading(false)
        setSupervisorResult(result)

        if (result.status === 'APPROVED') {
          appendSupervisorLine('Supervisor verdict: pass. Build approved.')
          if (result.suggestions?.length) {
            result.suggestions.forEach((suggestion, index) => {
              appendSupervisorLine(`Recommendation ${index + 1}: ${suggestion.idea} (${suggestion.effort})`)
            })
          }

          let approvedMessage = `Supervisor approved the build. ${result.summary}`
          if (result.suggestions && result.suggestions.length > 0) {
            approvedMessage += '\n\nRecommendations:\n'
            approvedMessage += result.suggestions
              .map((suggestion, index) => `${index + 1}. ${suggestion.idea} (${suggestion.effort}) — ${suggestion.description}`)
              .join('\n')
          }

          setMessages(prev => prev.map(m =>
            m.id === pendingVerification.reviewMessageId
              ? { ...m, content: approvedMessage }
              : m
          ))
          setTimeout(() => setShowSupervisor(false), 2200)
        } else {
          appendSupervisorLine('Supervisor verdict: fixes required before release.')
          result.fixes.forEach((fix, index) => {
            appendSupervisorLine(`Required fix ${index + 1}: ${fix.feature}`)
          })

          const issueList = result.fixes
            .map((fix, index) => `${index + 1}. ${fix.feature}: ${fix.description}`)
            .join('\n')

          setMessages(prev => prev.map(m =>
            m.id === pendingVerification.reviewMessageId
              ? { ...m, content: `Supervisor found blockers and I'm fixing them automatically now:\n${issueList}` }
              : m
          ))

          setTimeout(() => {
            autoApplyFixes(result)
          }, 1300)
        }
      } catch (err) {
        logError('builder.chat.supervisor_verification_failed', {
          message: err instanceof Error ? err.message : String(err),
        })
        setSupervisorLoading(false)
        setShowSupervisor(false)
        setMessages(prev => prev.map(m =>
          m.id === pendingVerification.reviewMessageId
            ? {
              ...m,
              content: 'Preview is live, but supervisor verification failed. I can retry the review or continue iterating.',
            }
            : m
        ))
      } finally {
        setPendingVerification(null)
      }
    }

    runVerification()
  }, [serverUrl, pendingVerification, autoApplyFixes, setMessages])

  return {
    showSupervisor,
    setShowSupervisor,
    supervisorLoading,
    supervisorResult,
    supervisorLiveLines,
    setSupervisorLiveLines,
    pendingVerification,
    setPendingVerification,
    handleSupervisorEvent,
  }
}
