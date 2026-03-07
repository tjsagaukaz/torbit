'use client'

import { useCallback, useMemo } from 'react'
import { useStreamingExecution, deriveUIState } from '@/hooks/useStreamingExecution'
import { useExecutionState } from '@/hooks/useExecutionState'
import ErrorBoundary from '@/components/ErrorBoundary'
import { error as logError, info as logInfo } from '@/lib/observability/logger.client'

/**
 * Example component demonstrating proper React patterns:
 * 1. Pure functions on render - all state derivation is pure
 * 2. Separated state vs side-effect logic - hooks manage state, components render UI
 * 3. Streaming cancel logic using run IDs - AbortController per run
 * 4. Prevention of stale updates on unmount - mountedRef checks
 * 5. Strict error boundaries - with error recovery
 * 6. Proper async cleanup - all AbortControllers cleaned up on unmount
 */

interface ExecutionPanelProps {
  projectId: string
  userId: string
  intent: string
  input: Record<string, unknown>
}

export function ExecutionPanel({
  projectId,
  userId,
  intent,
  input,
}: ExecutionPanelProps) {
  // Execution state with automatic ledger recording
  const execution = useExecutionState({
    projectId,
    userId,
    agentId: 'executor-agent',
    onExecutionStart: (runId) => {
      logInfo('builder.execution.started', { runId })
    },
    onExecutionComplete: (record) => {
      logInfo('builder.execution.recorded', { record })
    },
  })

  // Streaming for real-time output
  const streaming = useStreamingExecution({
    onChunk: (chunk) => {
      logInfo('builder.execution.chunk_received', { chunk })
    },
    onComplete: () => {
      logInfo('builder.execution.stream_completed')
    },
    onError: (error) => {
      logError('builder.execution.stream_failed', { message: error.message })
    },
  })

  // Pure function to derive UI state from execution state
  // This is completely side-effect free - can be memoized and tested in isolation
  const executionUIState = useMemo(() => {
    return {
      isRunning: execution.isRunning(),
      isComplete: execution.status === 'success',
      isFailed: execution.status === 'error',
      isCancelled: execution.status === 'cancelled',
      duration: execution.getDuration(),
      cost: execution.metrics?.cost,
      tokens: execution.metrics?.tokensUsed,
      errorMessage: execution.error?.message,
    }
  }, [execution])

  // Pure function to derive streaming UI state
  // All calculations are deterministic
  const streamingUIState = useMemo(() => {
    return deriveUIState({
      isStreaming: streaming.isStreaming,
      error: streaming.error,
      data: streaming.data,
      progress: streaming.progress,
    })
  }, [streaming.isStreaming, streaming.error, streaming.data, streaming.progress])

  // Start execution with streaming
  const handleStart = useCallback(async () => {
    // Generate unique run ID
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Start execution lifecycle
    execution.startExecution(intent, input, 'executor-agent')

    // Start streaming with same run ID
    try {
      await streaming.startStream(runId, async (signal) => {
        // API call with abort signal for proper cancellation
        const response = await fetch('/api/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent, input, runId }),
          signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        if (!response.body) {
          throw new Error('No response body')
        }

        return response.body
      })

      // On success, complete execution with metrics
      await execution.completeExecution(runId, streaming.data[streaming.data.length - 1] || {}, {
        cost: 100,
        duration: execution.getDuration() || 0,
        tokensUsed: streaming.data.length * 50,
        toolCalls: streaming.data.filter((d: any) => d.type === 'tool_call').length,
      })
    } catch (error) {
      // On error, record failure
      if (error instanceof Error && error.name !== 'AbortError') {
        execution.failExecution(runId, error)
      } else if (error instanceof Error && error.name === 'AbortError') {
        // Handle cancellation (AbortError is not a failure)
        execution.cancelExecution()
      }
    }
  }, [execution, streaming, intent, input])

  // Cancel both execution and streaming
  const handleCancel = useCallback(() => {
    streaming.cancelStream()
    execution.cancelExecution()
  }, [streaming, execution])

  // Reset for next execution
  const handleReset = useCallback(() => {
    execution.reset()
    streaming.reset()
  }, [execution, streaming])

  return (
    <ErrorBoundary
      resetKeys={[projectId, userId, intent]}
      fallback={(error, reset) => (
        <div
          className="p-4 bg-red-50 border border-red-200 rounded"
          data-testid="error-boundary-fallback"
        >
          <h3 className="font-semibold text-red-900">Execution Error</h3>
          <p className="text-red-700 text-sm">{error?.message}</p>
          <button
            onClick={reset}
            className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
            data-testid="error-retry"
          >
            Retry
          </button>
        </div>
      )}
    >
      <div className="p-4 bg-white border rounded shadow-sm" data-testid="execution-panel">
        {/* Header */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold">{intent}</h2>
          {execution.runId && (
            <p className="text-xs text-gray-500 font-mono" data-testid="run-id">
              {execution.runId}
            </p>
          )}
        </div>

        {/* Status Indicator */}
        <div
          className={`mb-4 px-3 py-2 rounded text-sm font-medium ${
            executionUIState.isRunning
              ? 'bg-blue-50 text-blue-700'
              : executionUIState.isComplete
                ? 'bg-green-50 text-green-700'
                : executionUIState.isFailed
                  ? 'bg-red-50 text-red-700'
                  : 'bg-gray-50 text-gray-700'
          }`}
          data-testid="status"
        >
          Status: {execution.status}
        </div>

        {/* Progress Bar */}
        {streamingUIState.shouldShowProgress && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs mb-1">
              <span>Processing</span>
              <span>{streamingUIState.progressPercent}%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${streamingUIState.progressPercent}%` }}
                data-testid="progress-bar"
              />
            </div>
          </div>
        )}

        {/* Error Display */}
        {executionUIState.isFailed && executionUIState.errorMessage && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {executionUIState.errorMessage}
          </div>
        )}

        {/* Metrics */}
        {(executionUIState.cost !== undefined || executionUIState.duration) && (
          <div className="mb-4 grid grid-cols-2 gap-2 text-xs">
            {executionUIState.duration && (
              <div className="p-2 bg-gray-50 rounded">
                <div className="text-gray-600">Duration</div>
                <div className="font-mono font-semibold" data-testid="duration">
                  {executionUIState.duration}ms
                </div>
              </div>
            )}
            {executionUIState.cost !== undefined && (
              <div className="p-2 bg-gray-50 rounded">
                <div className="text-gray-600">Cost</div>
                <div className="font-mono font-semibold" data-testid="cost">
                  ${(executionUIState.cost / 100).toFixed(2)}
                </div>
              </div>
            )}
            {executionUIState.tokens !== undefined && (
              <div className="p-2 bg-gray-50 rounded">
                <div className="text-gray-600">Tokens</div>
                <div className="font-mono font-semibold" data-testid="tokens">
                  {executionUIState.tokens}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Output Display */}
        {streamingUIState.resultCount > 0 && (
          <div className="mb-4 p-3 bg-gray-50 rounded max-h-96 overflow-y-auto">
            <div className="text-xs font-semibold text-gray-600 mb-2">
              Output ({streamingUIState.resultCount} items)
            </div>
            <pre className="text-xs font-mono whitespace-pre-wrap break-words">
              {JSON.stringify(streaming.data, null, 2)}
            </pre>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleStart}
            disabled={executionUIState.isRunning}
            className="flex-1 px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:bg-gray-400"
            data-testid="start-button"
          >
            {executionUIState.isRunning ? 'Running...' : 'Start'}
          </button>

          {streamingUIState.canCancel && (
            <button
              onClick={handleCancel}
              className="flex-1 px-3 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700"
              data-testid="cancel-button"
            >
              Cancel
            </button>
          )}

          {(executionUIState.isComplete || executionUIState.isFailed) && (
            <button
              onClick={handleReset}
              className="flex-1 px-3 py-2 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
              data-testid="reset-button"
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </ErrorBoundary>
  )
}
