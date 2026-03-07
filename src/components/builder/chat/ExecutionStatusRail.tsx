'use client'

import { motion } from 'framer-motion'
import type { BuildFailure } from '@/lib/runtime/build-diagnostics'

export type RunStatus = 'Thinking' | 'Working' | 'Reviewing' | 'Ready' | 'Needs Input'

interface ExecutionStatusRailProps {
  isBooting: boolean
  isReady: boolean
  serverUrl: string | null
  error: string | null
  buildFailure: BuildFailure | null
  isBuilding: boolean
  currentTask: string | null
  hasFiles: boolean
  statusLabel: RunStatus
  statusDetail: string
  onOpenVerification?: () => void
}

export function ExecutionStatusRail({
  isBooting,
  isReady,
  serverUrl,
  error,
  buildFailure,
  isBuilding,
  currentTask,
  hasFiles,
  statusLabel,
  statusDetail,
  onOpenVerification,
}: ExecutionStatusRailProps) {
  const fallbackDetail = error
    || buildFailure?.actionableFix
    || currentTask
    || (isBuilding ? 'Run in progress' : null)
    || (serverUrl ? 'Preview verified and ready' : null)
    || (isReady ? 'Environment prepared' : isBooting ? 'Environment booting' : null)
    || (hasFiles ? 'Artifacts generated' : null)
    || 'Awaiting request'

  const detail = statusDetail || fallbackDetail

  const toneClass = statusLabel === 'Needs Input'
    ? 'text-red-400'
    : statusLabel === 'Ready'
      ? 'text-emerald-400'
      : 'text-white/85'

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {statusLabel === 'Ready' ? (
          <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : statusLabel === 'Needs Input' ? (
          <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <motion.div
            className="w-3 h-3 rounded-full border border-white/30 border-t-white/70"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
          />
        )}
        <span className={`text-[11px] font-medium ${toneClass}`}>{statusLabel}</span>
      </div>

      <p className={`text-[11px] leading-relaxed ${statusLabel === 'Needs Input' ? 'text-red-400/80' : 'text-white/55'}`}>
        {detail}
      </p>

      {onOpenVerification && (isReady || Boolean(serverUrl)) && (
        <button
          type="button"
          onClick={onOpenVerification}
          className="text-[11px] text-white/50 hover:text-white/70 transition-colors"
          aria-label="Open verification details"
        >
          Open verification details
        </button>
      )}
    </div>
  )
}
