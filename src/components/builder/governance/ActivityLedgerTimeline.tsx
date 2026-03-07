'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import { useLedger, type LedgerEntry, type LedgerPhase } from '@/store/ledger'

// ============================================================================
// ACTIVITY LEDGER TIMELINE
// ============================================================================
// System-of-record timeline. Immutable. Past-tense only.
// 
// PURPOSE: Surface proof without demanding attention.
// 
// This is NOT a log viewer.
// This is a canonical narrative of what happened.
// 
// RULES:
// - Collapsed by default
// - Only completed steps show checkmarks
// - Immutable language (past tense only)
// - Readable by non-engineers (CTOs, auditors, security reviewers)
// - No stack traces, no raw commands
// ============================================================================

// Phase order for display
const PHASE_ORDER: LedgerPhase[] = ['describe', 'build', 'verify', 'export']

// Phase display config
const PHASE_CONFIG: Record<LedgerPhase, { label: string; pendingLabel: string }> = {
  describe: { label: 'Intent recorded', pendingLabel: 'Intent' },
  build: { label: 'Artifacts generated', pendingLabel: 'Build' },
  verify: { label: 'Auditor verification passed', pendingLabel: 'Verify' },
  export: { label: 'Project exported', pendingLabel: 'Export' },
}

interface ActivityLedgerTimelineProps {
  className?: string
}

export function ActivityLedgerTimeline({ className = '' }: ActivityLedgerTimelineProps) {
  const { entries, isExpanded, toggleExpanded, getCompletedCount, getEntry } = useLedger()
  const [expandedPhase, setExpandedPhase] = useState<LedgerPhase | null>(null)
  
  const completedCount = getCompletedCount()
  
  // Don't render if nothing has happened yet
  if (entries.length === 0) return null
  
  return (
    <div className={`${className}`}>
      {/* Collapsed State - Single line summary */}
      {!isExpanded && (
        <button
          onClick={toggleExpanded}
          className="w-full flex items-center justify-between py-2 text-left group"
        >
          <span className="text-[11px] text-[#505050]">
            Activity Ledger · {completedCount} verified step{completedCount !== 1 ? 's' : ''}
          </span>
          <span className="text-[11px] text-[#404040] group-hover:text-[#606060] transition-colors">
            View
          </span>
        </button>
      )}
      
      {/* Expanded State - Full timeline */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Header with collapse */}
            <button
              onClick={toggleExpanded}
              className="w-full flex items-center justify-between py-2 text-left group"
            >
              <span className="text-[11px] text-[#606060]">
                Activity Ledger
              </span>
              <span className="text-[11px] text-[#404040] group-hover:text-[#606060] transition-colors">
                Collapse
              </span>
            </button>
            
            {/* Timeline entries */}
            <div className="space-y-0.5 pb-2">
              {PHASE_ORDER.map((phase) => {
                const entry = getEntry(phase)
                const isComplete = !!entry
                const isPending = !isComplete
                const isPhaseExpanded = expandedPhase === phase && isComplete
                
                // Only show pending phases that are "next" (one after last complete)
                const lastCompleteIndex = PHASE_ORDER.findIndex(p => !getEntry(p)) - 1
                const currentPhaseIndex = PHASE_ORDER.indexOf(phase)
                const isNextPending = isPending && currentPhaseIndex === lastCompleteIndex + 1
                
                // Hide future pending phases
                if (isPending && !isNextPending) return null
                
                return (
                  <div key={phase}>
                    {/* Phase row */}
                    <button
                      onClick={() => isComplete && setExpandedPhase(isPhaseExpanded ? null : phase)}
                      disabled={!isComplete}
                      className={`w-full flex items-start gap-2 py-1.5 text-left ${
                        isComplete ? 'cursor-pointer group' : 'cursor-default'
                      }`}
                    >
                      {/* Status indicator */}
                      {isComplete ? (
                        <svg 
                          className="w-3 h-3 mt-0.5 text-[#505050] group-hover:text-[#707070] transition-colors flex-shrink-0" 
                          fill="none" 
                          viewBox="0 0 24 24" 
                          stroke="currentColor" 
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <div className="w-3 h-3 mt-0.5 rounded-full border border-[#303030] flex-shrink-0" />
                      )}
                      
                      {/* Label and timestamp */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={`text-[11px] ${
                            isComplete 
                              ? 'text-[#707070] group-hover:text-[#909090]' 
                              : 'text-[#404040]'
                          } transition-colors`}>
                            {isComplete ? entry.label : PHASE_CONFIG[phase].pendingLabel}
                          </span>
                          {entry?.completedAt && (
                            <span className="text-[10px] text-[#404040] flex-shrink-0">
                              {formatTimestamp(entry.completedAt)}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* Expand indicator */}
                      {isComplete && (
                        <svg 
                          className={`w-3 h-3 mt-0.5 text-[#404040] group-hover:text-[#606060] transition-all flex-shrink-0 ${
                            isPhaseExpanded ? 'rotate-90' : ''
                          }`}
                          fill="none" 
                          viewBox="0 0 24 24" 
                          stroke="currentColor" 
                          strokeWidth={1.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      )}
                    </button>
                    
                    {/* Expanded proof details */}
                    <AnimatePresence>
                      {isPhaseExpanded && entry?.proof && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.15 }}
                          className="ml-5 pl-2 border-l border-[#202020]"
                        >
                          <ProofDetails phase={phase} entry={entry} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============================================================================
// Proof Details Component
// ============================================================================

interface ProofDetailsProps {
  phase: LedgerPhase
  entry: LedgerEntry
}

function ProofDetails({ phase, entry }: ProofDetailsProps) {
  const proof = entry.proof
  if (!proof) return null
  
  return (
    <div className="py-2 space-y-1.5">
      {/* Describe phase */}
      {phase === 'describe' && proof.intentHash && (
        <ProofRow label="Intent hash" value={proof.intentHash} mono />
      )}
      
      {/* Build phase */}
      {phase === 'build' && (
        <>
          {proof.artifactCount !== undefined && (
            <ProofRow label="Files created" value={`${proof.artifactCount} files`} />
          )}
          
          {/* Capability-grouped artifacts */}
          {proof.capabilityArtifacts && proof.capabilityArtifacts.length > 0 && (
            <div className="pt-2 space-y-2">
              <div className="text-[10px] text-[#505050] uppercase tracking-wide">
                By Capability
              </div>
              {proof.capabilityArtifacts.map((cap, i) => (
                <CapabilityArtifactGroup key={i} capability={cap.capability} files={cap.files} />
              ))}
              <div className="text-[9px] text-[#404040] italic pt-1 border-t border-[#1a1a1a]">
                Artifacts are immutable once verified
              </div>
            </div>
          )}
          
          {/* Fallback: show flat file list if no capability grouping */}
          {!proof.capabilityArtifacts && proof.filesGenerated && proof.filesGenerated.length > 0 && (
            <div className="pt-1">
              {proof.filesGenerated.slice(0, 5).map((file, i) => (
                <div key={i} className="text-[10px] text-[#505050] font-mono truncate">
                  {file}
                </div>
              ))}
              {proof.filesGenerated.length > 5 && (
                <div className="text-[10px] text-[#404040]">
                  +{proof.filesGenerated.length - 5} more
                </div>
              )}
            </div>
          )}
        </>
      )}
      
      {/* Verify phase */}
      {phase === 'verify' && (
        <>
          <ProofRow 
            label="Auditor verdict" 
            value={proof.auditorVerdict === 'passed' ? 'PASSED' : 'FAILED'}
            valueClass={proof.auditorVerdict === 'passed' ? 'text-[#707070]' : 'text-red-400/70'}
          />
          {proof.runtimeHash && (
            <ProofRow label="Runtime hash" value={formatHash(proof.runtimeHash)} mono />
          )}
          {proof.dependencyLockHash && (
            <ProofRow label="Lock hash" value={formatHash(proof.dependencyLockHash)} mono />
          )}
        </>
      )}
      
      {/* Export phase */}
      {phase === 'export' && (
        <>
          {proof.exportFormat && (
            <ProofRow label="Format" value={proof.exportFormat} />
          )}
          {proof.includesProof !== undefined && (
            <ProofRow 
              label="Proof bundle" 
              value={proof.includesProof ? 'Included' : 'Not included'} 
            />
          )}
          {proof.capabilitiesIncluded && proof.capabilitiesIncluded.length > 0 && (
            <ProofRow 
              label="Capabilities" 
              value={`${proof.capabilitiesIncluded.length} scaffolded`} 
            />
          )}
        </>
      )}
      
      {/* Timestamp */}
      <ProofRow 
        label="Recorded" 
        value={formatExactTime(entry.completedAt)} 
        mono 
      />
    </div>
  )
}

// ============================================================================
// Helper Components
// ============================================================================

interface ProofRowProps {
  label: string
  value: string
  mono?: boolean
  valueClass?: string
}

function ProofRow({ label, value, mono, valueClass }: ProofRowProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[10px] text-[#505050] flex-shrink-0">{label}</span>
      <span className={`text-[10px] ${valueClass || 'text-[#606060]'} ${mono ? 'font-mono' : ''} text-right`}>
        {value}
      </span>
    </div>
  )
}

// Collapsible capability artifact group
interface CapabilityArtifactGroupProps {
  capability: string
  files: string[]
}

function CapabilityArtifactGroup({ capability, files }: CapabilityArtifactGroupProps) {
  const [expanded, setExpanded] = useState(false)
  
  // Format capability name for display
  const formatCapability = (cap: string) => {
    return cap.charAt(0).toUpperCase() + cap.slice(1).replace(/-/g, ' ')
  }
  
  return (
    <div className="border-l border-[#1a1a1a] pl-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] text-[#606060] hover:text-[#808080] transition-colors w-full text-left"
      >
        <motion.span
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          className="text-[8px]"
        >
          ▶
        </motion.span>
        <span className="font-medium">{formatCapability(capability)}</span>
        <span className="text-[#404040]">·</span>
        <span className="text-[#505050]">{files.length} files</span>
      </button>
      
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="pt-1 pl-3 space-y-0.5">
              {files.map((file, i) => (
                <div key={i} className="text-[9px] text-[#505050] font-mono truncate">
                  {file}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function formatTimestamp(ts: number): string {
  return formatDistanceToNow(ts, { addSuffix: true })
}

function formatExactTime(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

function formatHash(hash: string): string {
  if (hash.length <= 12) return hash
  return hash.slice(0, 8) + '…' + hash.slice(-4)
}
