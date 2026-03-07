'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { useBuilderStore } from '@/store/builder'
import type { PainSignal } from '@/lib/nervous-system'
import { MessageBubble } from './chat/MessageBubble'
import { ChatInput } from './chat/ChatInput'
import { RunDiagnosticsPanel } from './chat/RunDiagnosticsPanel'
import { EmptyState } from './chat/EmptyState'
import { ExecutionStatusRail } from './chat/ExecutionStatusRail'
import { TasteProfileRail } from './chat/TasteProfileRail'
import type { ActivityEntry } from './governance/InspectorView'
import { useE2BContext } from '@/providers/E2BProvider'
import { ActivityLedgerTimeline } from './governance/ActivityLedgerTimeline'
import { useLedger, generateLedgerHash } from '@/store/ledger'
import { useGenerationSound, useFileSound } from '@/lib/audio'
import { useGovernanceStore } from '@/store/governance'
import { useTasteProfileStore } from '@/store/tasteProfile'
import { getSupabase } from '@/lib/supabase/client'
import { info as logInfo } from '@/lib/observability/logger.client'
import type { Message, AgentId } from './chat/types'
import { ChatHistorySkeleton } from '@/components/ui/skeletons'
import { useStreamChat } from './chat/useStreamChat'
import { useSupervisor } from './chat/useSupervisor'
import type { RunDiagnosticsState } from './chat/useStreamChat'
import type { RunStatus } from './chat/ExecutionStatusRail'

const InspectorView = dynamic(
  () => import('./governance/InspectorView').then((module) => module.InspectorView),
  { ssr: false }
)
const VerificationDetailDrawer = dynamic(
  () => import('./governance/VerificationDetailDrawer').then((module) => module.VerificationDetailDrawer),
  { ssr: false }
)
const SupervisorSlidePanel = dynamic(
  () => import('./chat/SupervisorSlidePanel').then((module) => module.SupervisorSlidePanel),
  { ssr: false }
)

/**
 * ChatPanel - Single voice interface
 *
 * UX RULES:
 * - User talks to Torbit. Torbit is accountable.
 * - Agents are invisible infrastructure.
 * - No agent names, no model names, no background activity indicators.
 */
export default function ChatPanel() {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [currentTask, setCurrentTask] = useState<string | null>(null)
  const [showInspector, setShowInspector] = useState(false)
  const activities: ActivityEntry[] = []
  const selectedAgent: AgentId = 'architect'
  const [showVerificationDrawer, setShowVerificationDrawer] = useState(false)
  const [liveMessage, setLiveMessage] = useState('')
  const [runStatus, setRunStatus] = useState<RunStatus>('Ready')
  const [runStatusDetail, setRunStatusDetail] = useState<string>('')
  const [intentMode, setIntentMode] = useState<'auto' | 'chat' | 'action'>('auto')
  const [runDiagnostics, setRunDiagnostics] = useState<RunDiagnosticsState>({
    runId: null,
    intent: null,
    lastErrorClass: null,
    recoveryAction: 'No active faults.',
    fallbackCount: 0,
    gateFailures: 0,
    updatedAt: null,
  })

  const [isMounted, setIsMounted] = useState(false)

  const { isBooting, isReady, serverUrl, error, verification, buildFailure } = useE2BContext()

  // Sound effects
  const generationSound = useGenerationSound()
  const fileSound = useFileSound()

  // Prevent hydration mismatch by only showing client-dependent UI after mount
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Activity Ledger
  const {
    recordIntent,
    recordArtifactsGenerated,
    recordVerificationPassed,
    getPhaseStatus,
  } = useLedger()

  const {
    chatCollapsed,
    toggleChat,
    setAgentStatus,
    addFile,
    updateFile,
    deleteFile,
    setIsGenerating,
    projectId,
    prompt,
    files,
    projectType,
    capabilities,
    chatInput,
    setChatInput,
    pendingHealRequest,
    setPendingHealRequest,
  } = useBuilderStore()
  const tasteProfile = useTasteProfileStore((state) => {
    const key = projectId?.trim() || 'default'
    return state.profiles[key] || null
  })
  const resetTasteProfile = useTasteProfileStore((state) => state.resetProjectProfile)
  const [showTasteProfile, setShowTasteProfile] = useState(false)

  const focusComposer = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('torbit-focus-chat-input'))
    }
  }, [])

  const chatSessionSummary = runStatusDetail
    || currentTask
    || (isLoading
      ? 'Torbit is working on your request.'
      : messages.length === 0
        ? 'Describe the app you want to build.'
        : 'Ready for your next change.')

  const runToneClass = runStatus === 'Needs Input'
    ? 'text-red-300 border-red-500/30 bg-red-500/10'
    : runStatus === 'Ready'
      ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
      : 'text-white/80 border-white/15 bg-white/[0.04]'

  useEffect(() => {
    if (!tasteProfile) {
      setShowTasteProfile(false)
    }
  }, [tasteProfile])

  // --- Hooks for stream parsing and supervisor ---

  // Forward-declare handleSubmitMessage so useSupervisor can reference it
  const handleSubmitMessageRef = useRef<((content: string, agentId: AgentId, isHealRequest?: boolean) => Promise<void>) | null>(null)

  const supervisor = useSupervisor({
    projectId,
    selectedAgent,
    isLoading,
    messages,
    setMessages,
    setRunStatus,
    setRunStatusDetail,
    setRunDiagnostics,
    handleSubmitMessage: (...args) => handleSubmitMessageRef.current?.(...args) ?? Promise.resolve(),
    serverUrl,
    error,
    buildFailure,
    files,
    pendingHealRequest,
    setPendingHealRequest,
  })

  const { parseSSEStream, buildFileManifest } = useStreamChat({
    setAgentStatus,
    setMessages,
    setCurrentTask,
    setRunStatus,
    setRunStatusDetail,
    setRunDiagnostics,
    handleSupervisorEvent: supervisor.handleSupervisorEvent,
    addFile,
    updateFile,
    deleteFile,
    fileSound,
    files,
  })

  const generateGreeting = useCallback((promptText: string): string => {
    const promptLower = promptText.toLowerCase()
    const isIteration = promptLower.includes('add ') ||
                        promptLower.includes('change ') ||
                        promptLower.includes('update ') ||
                        promptLower.includes('fix ') ||
                        promptLower.includes('make it ') ||
                        promptLower.includes('modify ') ||
                        promptLower.includes('remove ')
    if (isIteration) return ''
    return ''
  }, [])

  const compileHighQualityBrief = useCallback((promptText: string): string => {
    const basePrompt = promptText.trim()
    if (!basePrompt) return promptText

    const qualityContract = projectType === 'mobile'
      ? [
        'QUALITY BAR:',
        '- Produce launch-grade mobile product work, not a prototype.',
        '- Follow Expo Router conventions and native-feeling navigation patterns.',
        '- Include empty, loading, success, and error states where relevant.',
        '- Use a distinct visual identity with deliberate typography, spacing, and motion.',
        '- Prefer believable seeded data, clear workflows, and production-safe component structure.',
        '- Avoid generic UI, placeholder copy, and thin screens with no edge-case handling.',
      ]
      : [
        'QUALITY BAR:',
        '- Produce launch-grade product work, not generic scaffolding.',
        '- Build a distinct visual identity with strong hierarchy, motion, and component rhythm.',
        '- Include empty, loading, success, and error states where relevant.',
        '- Use believable seeded data, real workflows, and production-safe architecture.',
        '- Make responsive behavior and accessibility first-class, not afterthoughts.',
        '- Avoid template-looking sections, filler copy, and shallow one-screen outputs.',
      ]

    return [basePrompt, '', ...qualityContract].join('\n')
  }, [projectType])

  const handleSubmitMessage = useCallback(async (messageContent: string, agentId: AgentId, isHealRequest: boolean = false) => {
    if (!messageContent.trim() || isLoading) return

    setIsLoading(true)
    setIsGenerating(true)
    setAgentStatus(agentId, 'thinking', isHealRequest ? 'Analyzing...' : 'Responding...')
    setCurrentTask(isHealRequest ? 'Diagnosing...' : 'Working on your request...')
    setRunStatus('Thinking')
    setRunStatusDetail(isHealRequest ? 'Diagnosing current issue' : 'Understanding request')

    generationSound.onStart()

    const assistantId = crypto.randomUUID()

    let initialContent: string
    if (isHealRequest) {
      const errorMatch = messageContent.match(/Error Type:\s*(\w+)/i) ||
                         messageContent.match(/(\w+_ERROR)/i) ||
                         messageContent.match(/Error:\s*(.+?)(?:\n|$)/i)
      const errorType = errorMatch?.[1] || 'issue'
      initialContent = `Detected: ${errorType.toLowerCase().replace(/_/g, ' ')}. Patching...`
    } else {
      initialContent = generateGreeting(messageContent)
    }

    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: initialContent,
      agentId,
      toolCalls: [],
    }])

    let requestFailed = false
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    try {
      if (!isHealRequest) {
        useTasteProfileStore.getState().ingestPrompt(projectId, messageContent)
      }

      const compiledMessageContent = isHealRequest || intentMode === 'chat'
        ? messageContent
        : compileHighQualityBrief(messageContent)

      const tasteProfilePrompt = useTasteProfileStore.getState().getPromptForProject(projectId)
      const persistedInvariants = useGovernanceStore.getState().getInvariantsForPrompt()
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      const supabase = getSupabase()
      if (supabase) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token) {
          headers.Authorization = `Bearer ${session.access_token}`
        }
      }

      const STREAM_IDLE_TIMEOUT_MS = 4 * 60 * 1000
      const resetStreamTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId)
        timeoutId = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS)
      }
      resetStreamTimeout()

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          messages: [...messages, { role: 'user', content: compiledMessageContent }]
            .filter(m => m.content && m.content.trim().length > 0)
            .map(m => ({ role: m.role, content: m.content })),
          agentId,
          projectId: projectId || undefined,
          projectType,
          capabilities,
          persistedInvariants,
          tasteProfilePrompt,
          fileManifest: buildFileManifest(),
          intentMode: isHealRequest ? 'action' : intentMode,
        }),
      })

      if (!response.ok) {
        let serverMessage = ''
        try {
          const payload = await response.json() as { error?: string }
          serverMessage = payload.error || ''
        } catch {
          // Ignore non-JSON body
        }
        const message = serverMessage || `HTTP ${response.status}: ${response.statusText}`
        throw new Error(message)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const streamResult = await parseSSEStream(
        reader,
        assistantId,
        agentId,
        initialContent,
        resetStreamTimeout
      )
      setAgentStatus(agentId, 'complete', 'Done')
      setRunStatus('Ready')
      setRunStatusDetail('Response completed')

      const mutationCalls = streamResult.toolCalls.filter((toolCall) => (
        toolCall.status === 'complete' && (
          toolCall.name === 'createFile' ||
          toolCall.name === 'editFile' ||
          toolCall.name === 'applyPatch' ||
          toolCall.name === 'deleteFile'
        )
      ))

      const latestFiles = useBuilderStore.getState().files
      if (!isHealRequest && mutationCalls.length > 0 && latestFiles.length > 0) {
        const filePaths = latestFiles.map(f => f.path)

        const componentNames = latestFiles
          .filter(f => f.path.includes('/components/'))
          .map(f => f.path.split('/').pop()?.replace(/\.(tsx|ts|jsx|js)$/, ''))
          .filter(Boolean)
          .slice(0, 5)

        const pageNames = latestFiles
          .filter(f => f.path.includes('page.'))
          .map(f => {
            const parts = f.path.split('/')
            const folder = parts[parts.length - 2]
            return folder === 'app' ? 'Home' : folder.charAt(0).toUpperCase() + folder.slice(1)
          })
          .filter((v, i, a) => a.indexOf(v) === i)

        const reviewMessageId = `complete-${Date.now()}`
        setMessages(prev => [...prev, {
          id: reviewMessageId,
          role: 'assistant',
          content: `I updated ${mutationCalls.length} file changes. Verifying preview runtime now.`,
          agentId,
          toolCalls: [],
        }])

        supervisor.setPendingVerification({
          reviewMessageId,
          originalPrompt: messageContent || prompt || '',
          filesCreated: filePaths,
          componentNames,
          pageNames,
          fileCount: latestFiles.length,
        })
      }
    } catch (error) {
      requestFailed = true
      if (!isHealRequest) {
        useTasteProfileStore.getState().recordRunOutcome(projectId, false)
      }
      setAgentStatus(agentId, 'error', 'Failed')
      setRunStatus('Needs Input')
      generationSound.onError()
      const errorMessage = error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out. Please try again.'
        : (error instanceof Error ? error.message : 'Unknown error')
      setRunStatusDetail(errorMessage)
      setRunDiagnostics((previous) => ({
        ...previous,
        lastErrorClass: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network',
        recoveryAction: 'Check connectivity and retry the request.',
        updatedAt: new Date().toISOString(),
      }))
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: '', error: { type: 'network', message: errorMessage, retryable: true }}
          : m
      ))
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      setIsLoading(false)
      setIsGenerating(false)
      setCurrentTask(null)
      if (!requestFailed) generationSound.onComplete()
    }
  }, [buildFileManifest, capabilities, compileHighQualityBrief, generateGreeting, generationSound, intentMode, isLoading, messages, parseSSEStream, projectId, projectType, prompt, setAgentStatus, setIsGenerating, supervisor])

  // Keep the ref in sync so useSupervisor can call handleSubmitMessage
  handleSubmitMessageRef.current = handleSubmitMessage

  // Auto-submit initial prompt
  useEffect(() => {
    if (prompt && messages.length === 0) {
      setMessages([{ id: 'init', role: 'user', content: prompt }])
      handleSubmitMessage(prompt, selectedAgent)
    }
  }, [prompt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ============================================================================
  // Activity Ledger Recording
  // ============================================================================

  useEffect(() => {
    if (messages.length > 0 && getPhaseStatus('describe') === 'pending') {
      const userMessage = messages.find(m => m.role === 'user')
      if (userMessage?.content) {
        recordIntent(generateLedgerHash(userMessage.content))
      }
    }
  }, [messages, getPhaseStatus, recordIntent])

  useEffect(() => {
    if (files.length > 0 && getPhaseStatus('build') === 'pending' && !isLoading) {
      recordArtifactsGenerated(
        files.length,
        files.map(f => f.path)
      )
    }
  }, [files, getPhaseStatus, isLoading, recordArtifactsGenerated])

  useEffect(() => {
    if (serverUrl && verification.sandboxId && verification.lockfileHash && getPhaseStatus('verify') === 'pending') {
      recordVerificationPassed(
        verification.sandboxId,
        verification.lockfileHash
      )
    }
  }, [serverUrl, verification, getPhaseStatus, recordVerificationPassed])

  // Pain signal listener (handled via pendingHealRequest)
  useEffect(() => {
    const handlePain = (e: CustomEvent<PainSignal>) => {
      logInfo('builder.chat.pain_signal.received', {
        signalType: e.detail.type,
      })
    }

    window.addEventListener('torbit-pain-signal', handlePain as EventListener)
    return () => window.removeEventListener('torbit-pain-signal', handlePain as EventListener)
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim()) return

    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', content: chatInput }])
    handleSubmitMessage(chatInput, selectedAgent)
    setChatInput('')
  }

  useEffect(() => {
    const latestAssistant = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.content?.trim().length)

    if (!latestAssistant?.content) {
      if (!isLoading) setLiveMessage('')
      return
    }

    const snippet = latestAssistant.content.replace(/\s+/g, ' ').trim().slice(-180)
    setLiveMessage(isLoading ? `Torbit is responding: ${snippet}` : `Torbit said: ${snippet}`)
  }, [messages, isLoading])

  useEffect(() => {
    if (chatCollapsed) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName
      const editable = Boolean(
        target
        && (target.isContentEditable
          || tagName === 'INPUT'
          || tagName === 'TEXTAREA'
          || tagName === 'SELECT')
      )

      if (!editable && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        focusComposer()
        return
      }

      if (!editable && !event.metaKey && !event.ctrlKey && !event.altKey && event.key === '/') {
        event.preventDefault()
        focusComposer()
        return
      }

      if (!editable && event.altKey && event.key.toLowerCase() === 'i') {
        event.preventDefault()
        setShowInspector((previous) => !previous)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [chatCollapsed, focusComposer])

  return (
    <motion.div
      className="h-full bg-[#000000] border-r border-[#151515] flex flex-col"
      animate={{ width: chatCollapsed ? 48 : 440 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      >
      <div className="sr-only" aria-live="polite" aria-atomic="false">
        {liveMessage}
      </div>

      {/* Header */}
      <div className="h-11 border-b border-white/[0.08] bg-[#050505]/95 flex items-center justify-between px-4 shrink-0 backdrop-blur-sm">
        <AnimatePresence mode="wait">
          {!chatCollapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2.5"
            >
              <div className={`w-2 h-2 rounded-full ${isLoading ? 'bg-emerald-400 animate-pulse' : 'bg-[#555555]'}`} />
              <span className="text-[13px] font-medium text-[#dddddd]">
                Build chat
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={toggleChat}
          className="w-6 h-6 flex items-center justify-center text-[#505050] hover:text-[#a8a8a8] hover:bg-[#0a0a0a] rounded transition-all"
          aria-label={chatCollapsed ? 'Expand chat panel' : 'Collapse chat panel'}
        >
          <svg
            className={`w-3.5 h-3.5 transition-transform ${chatCollapsed ? '' : 'rotate-180'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </button>
      </div>

      <AnimatePresence mode="wait">
        {!chatCollapsed && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="border-b border-white/[0.07] bg-[#050505]/90 px-4 py-2.5"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className={`rounded-md border px-2 py-1 text-[10px] font-medium ${runToneClass}`}>
                  {runStatus}
                </div>
                <div className="text-[10px] text-[#858585]">{files.length} {files.length === 1 ? 'file' : 'files'}</div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowInspector((previous) => !previous)}
                  className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                    showInspector
                      ? 'border-white/[0.24] bg-white/[0.12] text-[#f5f5f5]'
                      : 'border-white/[0.1] bg-white/[0.03] text-[#a8a8a8] hover:border-white/[0.16] hover:text-[#f2f2f2]'
                  }`}
                  aria-label="Toggle inspector (Alt+I)"
                  aria-pressed={showInspector}
                >
                  Details
                </button>
              </div>
            </div>

            <p className="truncate text-[11px] text-[#8e8e8e]">{chatSessionSummary}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <AnimatePresence mode="wait">
        {!chatCollapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 overflow-y-auto custom-scrollbar"
          >
            {messages.length === 0 ? (
              isLoading ? (
                <ChatHistorySkeleton />
              ) : (
                <EmptyState onSelectTemplate={(templatePrompt) => {
                  setChatInput(templatePrompt)
                }} />
              )
            ) : (
              <div className="p-4 space-y-0">
                {messages.map((message, i) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isLast={i === messages.length - 1}
                    isLoading={isLoading}
                    index={i}
                    onRetry={message.error?.retryable ? () => {
                      const precedingUserMsg = [...messages].slice(0, i).reverse().find(m => m.role === 'user')
                      if (!precedingUserMsg) return
                      setMessages(prev => prev.filter(m => m.id !== message.id))
                      handleSubmitMessage(precedingUserMsg.content, selectedAgent)
                    } : undefined}
                  />
                ))}
                {isLoading && <ChatHistorySkeleton rows={1} />}
                <div ref={messagesEndRef} />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Execution Status Rail */}
      <AnimatePresence mode="wait">
        {isMounted && !chatCollapsed && (isLoading || isBooting || (messages.length > 0 && files.length > 0)) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 py-3 border-t border-[#151515] bg-[#000000]"
          >
            <ExecutionStatusRail
              isBooting={isBooting}
              isReady={isReady}
              serverUrl={serverUrl}
              error={error}
              buildFailure={buildFailure}
              isBuilding={isLoading}
              currentTask={currentTask}
              hasFiles={files.length > 0}
              statusLabel={runStatus}
              statusDetail={runStatusDetail}
              onOpenVerification={() => setShowVerificationDrawer(true)}
            />

            <ActivityLedgerTimeline className="mt-2 pt-2 border-t border-[#101010]" />
            <RunDiagnosticsPanel diagnostics={runDiagnostics} />
            {tasteProfile && (
              <TasteProfileRail
                profile={tasteProfile}
                expanded={showTasteProfile}
                onToggle={() => setShowTasteProfile((prev) => !prev)}
                onReset={() => {
                  resetTasteProfile(projectId)
                  setShowTasteProfile(false)
                }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input */}
      <AnimatePresence mode="wait">
        {!chatCollapsed && (
          <ChatInput
            input={chatInput}
            isLoading={isLoading}
            onInputChange={setChatInput}
            onSubmit={handleSubmit}
            intentMode={intentMode}
            onIntentModeChange={setIntentMode}
            hasMessages={messages.length > 0}
          />
        )}
      </AnimatePresence>

      {/* Inspector View */}
      <InspectorView
        activities={activities}
        isOpen={showInspector}
        onClose={() => setShowInspector(false)}
      />

      {/* Verification Detail Drawer */}
      <VerificationDetailDrawer
        isOpen={showVerificationDrawer}
        onClose={() => setShowVerificationDrawer(false)}
        data={{
          environmentVerifiedAt: verification.environmentVerifiedAt,
          runtimeVersion: verification.runtimeVersion,
          sandboxId: verification.sandboxId,
          dependenciesLockedAt: verification.dependenciesLockedAt,
          dependencyCount: verification.dependencyCount,
          lockfileHash: verification.lockfileHash,
          buildCompletedAt: files.length > 0 ? Date.now() : null,
          artifactCount: files.length,
          auditorVerdict: isReady && serverUrl ? 'passed' : 'pending',
          auditorTimestamp: isReady && serverUrl ? Date.now() : null,
        }}
      />

      {/* Supervisor Slide Panel */}
      <SupervisorSlidePanel
        isOpen={supervisor.showSupervisor}
        isLoading={supervisor.supervisorLoading}
        result={supervisor.supervisorResult}
        liveLines={supervisor.supervisorLiveLines}
        onDismiss={() => supervisor.setShowSupervisor(false)}
      />
    </motion.div>
  )
}
