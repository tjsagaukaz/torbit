import { useCallback } from 'react'
import { useBuilderStore } from '@/store/builder'
import { useGovernanceStore } from '@/store/governance'
import { ExecutorService } from '@/services/executor'
import { error as logError } from '@/lib/observability/logger.client'
import type { Message, ToolCall, StreamChunk, AgentId } from './types'
import type { RunStatus } from './ExecutionStatusRail'

interface StreamChatDeps {
  setAgentStatus: (agentId: AgentId, status: 'idle' | 'thinking' | 'working' | 'complete' | 'error', task?: string, progress?: number) => void
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setCurrentTask: React.Dispatch<React.SetStateAction<string | null>>
  setRunStatus: React.Dispatch<React.SetStateAction<RunStatus>>
  setRunStatusDetail: React.Dispatch<React.SetStateAction<string>>
  setRunDiagnostics: React.Dispatch<React.SetStateAction<RunDiagnosticsState>>
  handleSupervisorEvent: (event: SupervisorEvent) => void
  addFile: (file: Omit<import('@/store/builder').ProjectFile, 'id'>) => void
  updateFile: (id: string, content: string) => void
  deleteFile: (id: string) => void
  fileSound: { onCreate: () => void; onEdit: () => void }
  files: import('@/store/builder').ProjectFile[]
}

export interface RunDiagnosticsState {
  runId: string | null
  intent: string | null
  lastErrorClass: string | null
  recoveryAction: string
  fallbackCount: number
  gateFailures: number
  updatedAt: string | null
}

export type SupervisorEvent = {
  event: 'run_started' | 'intent_classified' | 'route_selected' | 'gate_started' | 'gate_passed' | 'gate_failed' | 'autofix_started' | 'autofix_succeeded' | 'autofix_failed' | 'fallback_invoked' | 'run_completed'
  timestamp: string
  run_id: string
  stage: string
  summary: string
  details: Record<string, unknown>
}

function normalizeBuilderPath(value: string): string {
  return value.replace(/^\/+/, '')
}

export function useStreamChat(deps: StreamChatDeps) {
  const {
    setAgentStatus,
    setMessages,
    setCurrentTask,
    setRunStatus,
    setRunStatusDetail,
    setRunDiagnostics,
    handleSupervisorEvent,
    addFile,
    updateFile,
    deleteFile,
    fileSound,
  } = deps

  const applyUnifiedPatch = useCallback((existingContent: string, patch: string): string | null => {
    try {
      const lines = existingContent.split('\n')
      const patchLines = patch.split('\n')
      const resultLines = [...lines]
      let offset = 0

      for (let i = 0; i < patchLines.length; i++) {
        const line = patchLines[i]
        const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/)
        if (!hunkMatch) continue

        const oldStart = parseInt(hunkMatch[1], 10) - 1
        let lineIndex = oldStart + offset

        i++
        while (i < patchLines.length && !patchLines[i].startsWith('@@')) {
          const patchLine = patchLines[i]

          if (patchLine.startsWith('-')) {
            resultLines.splice(lineIndex, 1)
            offset--
          } else if (patchLine.startsWith('+')) {
            resultLines.splice(lineIndex, 0, patchLine.slice(1))
            lineIndex++
            offset++
          } else if (patchLine.startsWith(' ')) {
            lineIndex++
          }

          i++
        }
        i--
      }

      return resultLines.join('\n')
    } catch {
      return null
    }
  }, [])

  const applyToolMutationToStore = useCallback((toolCall: ToolCall) => {
    const pathValue = typeof toolCall.args.path === 'string' ? toolCall.args.path : null
    const state = useBuilderStore.getState()

    const findByPath = (path: string) => {
      const normalizedPath = normalizeBuilderPath(path)
      return state.files.find((file) => normalizeBuilderPath(file.path) === normalizedPath)
    }

    const upsertFileByPath = (path: string, content: string) => {
      const normalizedPath = normalizeBuilderPath(path)
      const existingFile = findByPath(normalizedPath)
      if (existingFile) {
        updateFile(existingFile.id, content)
      } else {
        addFile({
          path: normalizedPath,
          name: normalizedPath.split('/').pop() || 'untitled',
          content,
          language: normalizedPath.split('.').pop() || 'text',
        })
      }
    }

    if (toolCall.name === 'createFile') {
      const content = typeof toolCall.args.content === 'string' ? toolCall.args.content : null
      if (pathValue && content !== null) {
        upsertFileByPath(pathValue, content)
        fileSound.onCreate()
      }
      return
    }

    if (toolCall.name === 'editFile') {
      if (!pathValue) return
      const content = typeof toolCall.args.content === 'string' ? toolCall.args.content : null

      if (content !== null) {
        upsertFileByPath(pathValue, content)
        fileSound.onEdit()
        return
      }

      const existingFile = findByPath(pathValue)
      const oldContent = typeof toolCall.args.oldContent === 'string' ? toolCall.args.oldContent : null
      const newContent = typeof toolCall.args.newContent === 'string' ? toolCall.args.newContent : null
      if (!existingFile || oldContent === null || newContent === null) return

      if (existingFile.content.includes(oldContent)) {
        updateFile(existingFile.id, existingFile.content.replace(oldContent, newContent))
        fileSound.onEdit()
      }
      return
    }

    if (toolCall.name === 'applyPatch') {
      const patch = typeof toolCall.args.patch === 'string' ? toolCall.args.patch : null
      if (!pathValue || patch === null) return
      const existingFile = findByPath(pathValue)
      if (!existingFile) return

      const nextContent = applyUnifiedPatch(existingFile.content, patch)
      if (nextContent !== null) {
        updateFile(existingFile.id, nextContent)
        fileSound.onEdit()
      }
      return
    }

    if (toolCall.name === 'deleteFile' && pathValue) {
      const existingFile = findByPath(pathValue)
      if (existingFile) {
        deleteFile(existingFile.id)
      }
    }
  }, [addFile, applyUnifiedPatch, deleteFile, fileSound, updateFile])

  const parseSSEStream = useCallback(async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    assistantId: string,
    agentId: AgentId,
    initialContent: string = '',
    onActivity?: () => void
  ) => {
    const decoder = new TextDecoder()
    let buffer = ''
    let fullContent = initialContent ? initialContent + '\n\n' : ''
    const toolCalls: Map<string, ToolCall> = new Map()
    const appliedMutationIds = new Set<string>()
    const toolExecutionPromises: Promise<void>[] = []

    const applyMutationFromToolCall = (toolCall: ToolCall) => {
      if (!['createFile', 'editFile', 'applyPatch', 'deleteFile'].includes(toolCall.name)) {
        return
      }
      if (appliedMutationIds.has(toolCall.id)) return
      applyToolMutationToStore(toolCall)
      appliedMutationIds.add(toolCall.id)
    }

    const buildFallbackSummary = (calls: ToolCall[]): string => {
      if (calls.length === 0) {
        return 'Request completed, but no response text was returned. Please retry for a detailed explanation.'
      }

      const mutationCalls = calls.filter((tc) => (
        tc.name === 'createFile' ||
        tc.name === 'editFile' ||
        tc.name === 'applyPatch' ||
        tc.name === 'deleteFile'
      ))

      if (mutationCalls.length === 0) {
        return `Completed ${calls.length} tool step${calls.length === 1 ? '' : 's'}. Review the action log for details.`
      }

      const paths = Array.from(new Set(
        mutationCalls
          .map((tc) => (typeof tc.args.path === 'string' ? tc.args.path.trim() : ''))
          .filter((p) => p.length > 0)
      ))

      if (paths.length === 0) {
        return `Applied ${mutationCalls.length} file change${mutationCalls.length === 1 ? '' : 's'}.`
      }

      const preview = paths.slice(0, 3).join(', ')
      const suffix = paths.length > 3 ? ` and ${paths.length - 3} more` : ''
      return `Applied ${mutationCalls.length} file change${mutationCalls.length === 1 ? '' : 's'}: ${preview}${suffix}.`
    }

    const getTaskName = (toolName: string, args: Record<string, unknown>): string => {
      if (toolName === 'createFile' && args.path) {
        return (args.path as string).split('/').pop() || 'file'
      }
      if (toolName === 'think') return 'Working'
      if (toolName === 'verifyDependencyGraph') return 'Checking dependencies'
      return toolName.replace(/([A-Z])/g, ' $1').trim()
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      onActivity?.()
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue

        try {
          const chunk: StreamChunk = JSON.parse(line.slice(6))

          switch (chunk.type) {
            case 'text':
              fullContent += chunk.content || ''
              setMessages(prev => prev.map(m =>
                m.id === assistantId
                  ? { ...m, content: fullContent, toolCalls: Array.from(toolCalls.values()) }
                  : m
              ))
              break

            case 'tool-call':
              if (chunk.toolCall) {
                const existing = toolCalls.get(chunk.toolCall.id)

                const tc: ToolCall = {
                  id: chunk.toolCall.id,
                  name: chunk.toolCall.name,
                  args: chunk.toolCall.args,
                  status: existing?.status || 'running',
                }

                const isNewCall = !existing

                toolCalls.set(tc.id, tc)

                if (isNewCall) {
                  const taskName = getTaskName(tc.name, tc.args)
                  setCurrentTask(taskName)
                  setAgentStatus(agentId, 'working', taskName)
                  setRunStatus('Working')
                  setRunStatusDetail(taskName)
                }

                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? { ...m, toolCalls: Array.from(toolCalls.values()) }
                    : m
                ))

                const isAvailable = ExecutorService.isToolAvailable(tc.name)
                if (isNewCall && isAvailable) {
                  const executionPromise = ExecutorService.executeTool(tc.name, tc.args).then((result) => {
                    const existingTc = toolCalls.get(tc.id)
                    if (existingTc) {
                      existingTc.status = result.success ? 'complete' : 'error'
                      existingTc.result = { success: result.success, output: result.output, duration: result.duration }
                      toolCalls.set(existingTc.id, existingTc)

                      if (result.success) {
                        applyMutationFromToolCall(existingTc)
                      }

                      setMessages(prev => prev.map(m =>
                        m.id === assistantId
                          ? { ...m, toolCalls: Array.from(toolCalls.values()) }
                          : m
                      ))
                    }
                  }).catch((error) => {
                    const existingTc = toolCalls.get(tc.id)
                    if (existingTc) {
                      existingTc.status = 'error'
                      existingTc.result = { success: false, output: error instanceof Error ? error.message : 'Unknown error', duration: 0 }
                      toolCalls.set(existingTc.id, existingTc)

                      setMessages(prev => prev.map(m =>
                        m.id === assistantId
                          ? { ...m, toolCalls: Array.from(toolCalls.values()) }
                          : m
                      ))
                    }
                  })
                  toolExecutionPromises.push(executionPromise)
                }
              }
              break

            case 'tool-result':
              if (chunk.toolResult) {
                const existing = toolCalls.get(chunk.toolResult.id)
                if (existing) {
                  existing.status = chunk.toolResult.success ? 'complete' : 'error'
                  existing.result = chunk.toolResult
                  toolCalls.set(existing.id, existing)
                  if (chunk.toolResult.success) {
                    applyMutationFromToolCall(existing)
                  }
                  setMessages(prev => prev.map(m =>
                    m.id === assistantId
                      ? { ...m, toolCalls: Array.from(toolCalls.values()) }
                      : m
                  ))
                }
              }
              break

            case 'usage':
              if (chunk.usage) {
                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? { ...m, usage: chunk.usage }
                    : m
                ))
              }
              break

            case 'governance':
              if (chunk.governance) {
                useGovernanceStore.getState().addGovernance({
                  verdict: chunk.governance.verdict as 'approved' | 'approved_with_amendments' | 'rejected' | 'escalate',
                  confidence: 'medium',
                  scope: {
                    intent: chunk.governance.intent,
                    affected_areas: [],
                  },
                  protected_invariants: chunk.governance.invariants.map(inv => ({
                    description: inv.description,
                    scope: inv.scope,
                    severity: inv.severity,
                  })),
                })
              }
              break

            case 'proof':
              if (chunk.proof) {
                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? { ...m, proofLines: chunk.proof }
                    : m
                ))
              }
              break

            case 'error':
              if (chunk.error) {
                const streamError = chunk.error
                setRunStatus('Needs Input')
                setRunStatusDetail(streamError.message)
                setRunDiagnostics((previous) => ({
                  ...previous,
                  lastErrorClass: streamError.type || 'stream_error',
                  recoveryAction: streamError.retryable
                    ? 'Temporary failure detected. Retry the same request.'
                    : 'Address the reported issue and submit a corrected request.',
                  updatedAt: new Date().toISOString(),
                }))
                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? { ...m, error: streamError, content: fullContent || '' }
                    : m
                ))
              }
              break

            case 'retry':
              if (chunk.retry) {
                setRunStatus('Reviewing')
                setRunStatusDetail(`Retry attempt ${chunk.retry.attempt + 1}`)
                const retryMessage = fullContent || `Retrying request (${chunk.retry.attempt + 1}/${chunk.retry.maxAttempts})...`
                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? { ...m, content: retryMessage, retrying: true }
                    : m
                ))
              }
              break

            case 'supervisor-event':
              if (chunk.event) {
                handleSupervisorEvent(chunk.event)
              }
              break
          }
        } catch (parseError) {
          logError('builder.chat.sse_parse_error', {
            line,
            message: parseError instanceof Error ? parseError.message : String(parseError),
          })
        }
      }
    }

    if (toolExecutionPromises.length > 0) {
      await Promise.all(toolExecutionPromises)
    }

    const allToolCalls = Array.from(toolCalls.values())
    if (!fullContent.trim()) {
      fullContent = buildFallbackSummary(allToolCalls)
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: fullContent, toolCalls: allToolCalls, retrying: false }
          : m
      ))
    }

    const createFileCalls = allToolCalls.filter(tc => tc.name === 'createFile')
    const editFileCalls = allToolCalls.filter(tc => tc.name === 'editFile')
    const patchCalls = allToolCalls.filter(tc => tc.name === 'applyPatch')
    const testCalls = allToolCalls.filter(tc => tc.name === 'runTests' || tc.name === 'runE2eCycle')

    if (createFileCalls.length > 0 || editFileCalls.length > 0 || patchCalls.length > 0) {
      const proofLines: Array<{ label: string; status: 'verified' | 'warning' | 'failed' }> = []

      const successFiles = createFileCalls.filter(tc => tc.status === 'complete')
      const failedFiles = createFileCalls.filter(tc => tc.status === 'error')

      if (successFiles.length > 0 && failedFiles.length === 0) {
        proofLines.push({ label: `${successFiles.length} files generated (awaiting runtime verification)`, status: 'warning' })
      } else if (failedFiles.length > 0) {
        proofLines.push({ label: `${failedFiles.length} file(s) failed to create`, status: 'failed' })
      }

      if (editFileCalls.length > 0 || patchCalls.length > 0) {
        const writeCalls = [...editFileCalls, ...patchCalls]
        const successEdits = writeCalls.filter(tc => tc.status === 'complete')
        if (successEdits.length === writeCalls.length) {
          proofLines.push({ label: `${successEdits.length} files updated (awaiting runtime verification)`, status: 'warning' })
        }
      }

      if (testCalls.length > 0) {
        const passedTests = testCalls.filter(tc => tc.status === 'complete')
        if (passedTests.length === testCalls.length) {
          proofLines.push({ label: 'All tests passed', status: 'verified' })
        } else {
          proofLines.push({ label: 'Some tests failed', status: 'warning' })
        }
      }

      if (proofLines.length > 0) {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, proofLines }
            : m
        ))
      }
    }

    setCurrentTask(null)
    return { content: fullContent, toolCalls: Array.from(toolCalls.values()) }
  }, [setAgentStatus, applyToolMutationToStore, handleSupervisorEvent, setMessages, setCurrentTask, setRunStatus, setRunStatusDetail, setRunDiagnostics])

  const buildFileManifest = useCallback(() => {
    const files = useBuilderStore.getState().files
    const manifest = files
      .slice(0, 300)
      .map((file) => ({
        path: normalizeBuilderPath(file.path),
        bytes: file.content.length,
      }))

    return {
      files: manifest,
      truncated: files.length > manifest.length,
      totalFiles: files.length,
    }
  }, [])

  return { parseSSEStream, buildFileManifest }
}
