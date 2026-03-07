'use client'

import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react'
import { motion } from 'framer-motion'
import { Check, Loader2, ShieldCheck, Copy, CheckCheck } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ActionLog } from './ActionLog'
import { getToolCallDetail, getToolCallHeadline } from './activityCopy'
import type { Message, ToolCall, ProofLine } from './types'

interface StreamingMessageProps {
  message: Message
  isLast: boolean
  isLoading: boolean
  onRetry?: () => void
}

type GenerationPhase = 'thinking' | 'creating' | 'reviewing' | 'ready'

function getPhaseFromTools(toolCalls: ToolCall[], isLoading: boolean): GenerationPhase {
  if (!isLoading) return 'ready'
  if (toolCalls.length === 0) return 'thinking'

  const lastCall = toolCalls[toolCalls.length - 1]
  if (lastCall?.name === 'think') return 'thinking'
  if (
    lastCall?.name === 'runCommand' ||
    lastCall?.name === 'executeCommand' ||
    lastCall?.name === 'runTests' ||
    lastCall?.name === 'runE2eCycle'
  ) {
    return 'reviewing'
  }

  return 'creating'
}

function stripInlineFilePaths(content: string): string {
  if (!content) return ''
  let clean = content.replace(/\/\/\s*[\w\/.@_-]+\.(tsx?|jsx?|css|json|md)\n/g, '')
  clean = clean.replace(/\n{3,}/g, '\n\n').trim()
  return clean
}

function formatElapsedTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function getPhaseHeadline(phase: GenerationPhase): string {
  switch (phase) {
    case 'thinking':
      return '🧭 Getting oriented'
    case 'creating':
      return '🛠️ Building the first pass'
    case 'reviewing':
      return '🧪 Checking the result'
    case 'ready':
    default:
      return '✅ Ready'
  }
}

function getLiveStatusDetail(input: {
  phase: GenerationPhase
  hasToolCalls: boolean
  elapsedSeconds: number
  statusCount: number
}): string {
  if (input.hasToolCalls) {
    return 'I’m in the project now and I’ll keep each meaningful step visible here.'
  }

  if (input.elapsedSeconds >= 45) {
    return 'This request is taking a bit longer, but I’m still checking the project and lining up the safest first pass.'
  }

  if (input.elapsedSeconds >= 20) {
    return 'I’m still with you. I’m reviewing the current project before I start changing files.'
  }

  if (input.statusCount > 0) {
    return 'I’ll keep posting the next real step here as I move through the build.'
  }

  switch (input.phase) {
    case 'thinking':
      return 'I’m reading your request and checking the current project before I touch anything.'
    case 'reviewing':
      return 'I’m validating the environment and checking the result before I wrap up.'
    case 'creating':
      return 'I’m moving through the first pass and I’ll stream the file activity here.'
    case 'ready':
    default:
      return 'Your update is ready.'
  }
}

export const StreamingMessage = memo(function StreamingMessage({
  message,
  isLast,
  isLoading,
  onRetry,
}: StreamingMessageProps) {
  const toolCalls = useMemo(() => message.toolCalls ?? [], [message.toolCalls])
  const statusLines = useMemo(() => message.statusLines ?? [], [message.statusLines])
  const [copied, setCopied] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  const handleCopy = useCallback(() => {
    if (!message.content) return
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [message.content])

  const [createdFiles, setCreatedFiles] = useState<Set<string>>(new Set())
  const prevCompletedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    setCreatedFiles(new Set())
    prevCompletedRef.current = new Set()
  }, [message.id])

  useEffect(() => {
    if (!(isLoading && isLast)) {
      setElapsedSeconds(0)
      return
    }

    const startedAt = Date.now()
    const updateElapsed = () => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }

    updateElapsed()
    const timer = window.setInterval(updateElapsed, 1000)
    return () => window.clearInterval(timer)
  }, [isLast, isLoading, message.id])

  const phase = getPhaseFromTools(toolCalls, isLoading && isLast)
  const fileToolCalls = useMemo(
    () => toolCalls.filter((toolCall) => toolCall.name === 'createFile'),
    [toolCalls]
  )
  const displayContent = useMemo(
    () => stripInlineFilePaths(message.content || ''),
    [message.content]
  )

  useEffect(() => {
    const completedFileIds = new Set(
      fileToolCalls.filter((toolCall) => toolCall.status === 'complete').map((toolCall) => toolCall.id)
    )
    const newlyCompleted = [...completedFileIds].filter((id) => !prevCompletedRef.current.has(id))

    if (newlyCompleted.length > 0) {
      newlyCompleted.forEach((id, index) => {
        const delay = 800 + index * 200
        setTimeout(() => {
          setCreatedFiles((previous) => new Set([...previous, id]))
        }, delay)
      })

      prevCompletedRef.current = new Set(completedFileIds)
    }
  }, [fileToolCalls])

  const createdCount = createdFiles.size
  const proofLines: ProofLine[] = message.proofLines || []

  const activeToolCall = useMemo(() => {
    const runningToolCall = [...toolCalls].reverse().find((toolCall) => toolCall.status === 'running')
    if (runningToolCall) return runningToolCall
    return isLoading && isLast ? toolCalls[toolCalls.length - 1] ?? null : null
  }, [isLast, isLoading, toolCalls])

  const liveHeadline = activeToolCall
    ? getToolCallHeadline(activeToolCall)
    : statusLines[statusLines.length - 1] || getPhaseHeadline(phase)

  const liveDetail = activeToolCall
    ? getToolCallDetail(activeToolCall)
    : getLiveStatusDetail({
      phase,
      hasToolCalls: toolCalls.length > 0,
      elapsedSeconds,
      statusCount: statusLines.length,
    })

  const statusHistoryLines = useMemo(() => {
    if (statusLines.length === 0) return []
    if (activeToolCall) return statusLines.slice(-3)
    return statusLines.slice(0, -1).slice(-2)
  }, [activeToolCall, statusLines])

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="py-3">
      {isLoading && isLast && (
        <div className="rounded-[22px] border border-[#1d1d1d] bg-[#0f0f0f] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-[#6f6f6f]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#8c8c8c]" />
              <span>{activeToolCall ? 'Live Activity' : 'Torbit Is Working'}</span>
            </div>
            <span className="text-[11px] text-[#6f6f6f]">{formatElapsedTime(elapsedSeconds)}</span>
          </div>

          <div className="mt-2 text-[15px] font-medium text-[#f2f2f2]">
            {liveHeadline}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-[#a3a3a3]">
            {liveDetail}
          </p>
        </div>
      )}

      {statusHistoryLines.length > 0 && (
        <div className="space-y-1.5 pt-2">
          {statusHistoryLines.map((line, index) => (
            <div key={`${line}-${index}`} className="flex items-center gap-2.5 pl-2 py-0.5">
              <div className="h-[7px] w-[7px] rounded-full bg-[#2f2f2f]" />
              <span className="text-[12px] text-[#8c8c8c]">{line}</span>
            </div>
          ))}
        </div>
      )}

      {toolCalls.length > 0 && (
        <ActionLog
          toolCalls={toolCalls}
          isLoading={isLoading && isLast}
          className="pt-2"
        />
      )}

      {displayContent && (
        <div className={`text-[13px] leading-relaxed text-[#b3b3b3] ${isLoading && isLast ? 'mt-3' : 'mt-2'}`}>
          <MarkdownRenderer content={displayContent} />
        </div>
      )}

      {!isLoading && displayContent && (
        <div className="group/meta mt-1.5 flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[11px] text-[#404040] opacity-0 transition-colors hover:text-[#909090] group-hover/meta:opacity-100 focus:opacity-100"
            aria-label="Copy message"
            title="Copy to clipboard"
          >
            {copied ? <CheckCheck className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <span className="text-[10px] text-[#333] opacity-0 group-hover/meta:opacity-100">
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}

      {message.error && (
        <div className="mt-2 rounded-lg border border-red-500/10 bg-red-500/5">
          <div className="flex items-start gap-2.5 p-3">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-[13px] text-red-400">{message.error.message}</p>
          </div>
          {message.error.retryable && onRetry && (
            <div className="px-3 pb-3">
              <button
                type="button"
                onClick={onRetry}
                className="rounded-md border border-red-500/20 px-3 py-1.5 text-[12px] text-red-400 transition-colors hover:border-red-500/40 hover:text-red-300"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      {!isLoading && createdCount > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1 pt-2">
          <div className="flex items-center gap-2 text-[11px] text-[#737373]">
            <ShieldCheck className="h-3 w-3 text-emerald-500/60" />
            <span>{createdCount} files ready</span>
          </div>
          {proofLines.length > 0 && (
            <div className="space-y-0.5 pl-5">
              {proofLines.map((line, index) => (
                <div key={index} className="flex items-center gap-1.5 text-[11px]">
                  {line.status === 'verified' && (
                    <Check className="h-3 w-3 text-emerald-500/50" />
                  )}
                  {line.status === 'warning' && (
                    <svg className="h-3 w-3 text-amber-500/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                    </svg>
                  )}
                  {line.status === 'failed' && (
                    <svg className="h-3 w-3 text-red-500/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                  <span className={
                    line.status === 'verified'
                      ? 'text-[#737373]'
                      : line.status === 'warning'
                        ? 'text-amber-500/60'
                        : 'text-red-500/60'
                  }>
                    {line.label}{line.status === 'verified' ? ' (verified)' : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  )
})

export type { GenerationPhase }
