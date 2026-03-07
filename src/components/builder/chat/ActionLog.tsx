'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { 
  Check, 
  FileText, 
  FilePlus2, 
  FileEdit, 
  Eye, 
  Trash2,
  Terminal,
  Package,
  Sparkles,
  Search,
  AlertCircle
} from 'lucide-react'
import type { ToolCall } from './types'
import { getToolCallLabel } from './activityCopy'

// ============================================================================
// ACTION LOG - Minimal connected-line timeline (v0-style)
// No emoji commentary, no grouping, just clean action items
// ============================================================================

interface ActionMeta {
  icon: React.ReactNode
  label: string
}

/**
 * Parse action metadata from tool call
 */
function getActionMeta(toolCall: ToolCall): ActionMeta {
  switch (toolCall.name) {
    case 'think':
      return {
        icon: <Sparkles className="w-3.5 h-3.5" />,
        label: getToolCallLabel(toolCall),
      }
    case 'createFile':
      return {
        icon: <FilePlus2 className="w-3.5 h-3.5" />,
        label: getToolCallLabel(toolCall),
      }
    case 'editFile':
    case 'replaceInFile':
    case 'applyPatch':
      return {
        icon: <FileEdit className="w-3.5 h-3.5" />,
        label: getToolCallLabel(toolCall),
      }
    case 'readFile':
      return {
        icon: <Eye className="w-3.5 h-3.5" />,
        label: getToolCallLabel(toolCall),
      }
    case 'deleteFile':
      return {
        icon: <Trash2 className="w-3.5 h-3.5" />,
        label: getToolCallLabel(toolCall),
      }
    case 'runCommand':
    case 'executeCommand':
      return {
        icon: <Terminal className="w-3.5 h-3.5" />,
        label: getToolCallLabel(toolCall),
      }
    case 'installPackage':
    case 'installDependency':
      return {
        icon: <Package className="w-3.5 h-3.5" />,
        label: getToolCallLabel(toolCall),
      }
    case 'searchFiles':
    case 'findInFiles':
      return {
        icon: <Search className="w-3.5 h-3.5" />,
        label: getToolCallLabel(toolCall),
      }
    case 'listFiles':
    case 'listDirectory':
      return {
        icon: <FileText className="w-3.5 h-3.5" />,
        label: getToolCallLabel(toolCall),
      }
    default:
      return {
        icon: <FileText className="w-3.5 h-3.5" />,
        label: getToolCallLabel(toolCall),
      }
  }
}

interface ActionLogProps {
  toolCalls: ToolCall[]
  isLoading: boolean
  className?: string
}

/**
 * Single action item - dot on the left connected by a thin vertical line
 */
function ActionItem({ toolCall, isLast }: { toolCall: ToolCall; isLast: boolean }) {
  const meta = getActionMeta(toolCall)
  const isRunning = toolCall.status === 'running'
  const isError = toolCall.status === 'error'
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative flex items-start gap-2.5 pl-4"
    >
      {/* Vertical connecting line */}
      {!isLast && (
        <div className="absolute left-[7px] top-[18px] bottom-[-2px] w-px bg-[#1f1f1f]" />
      )}
      
      {/* Status dot */}
      <div className="relative z-10 mt-[5px] flex-shrink-0">
        {isRunning ? (
          <motion.div
            className="w-[7px] h-[7px] rounded-full bg-[#808080]"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : isError ? (
          <div className="w-[7px] h-[7px] rounded-full bg-red-400" />
        ) : (
          <div className="w-[7px] h-[7px] rounded-full bg-[#333]" />
        )}
      </div>
      
      {/* Action content */}
      <div className="flex items-center gap-1.5 py-0.5 min-w-0">
        <span className={`flex-shrink-0 ${
          isError ? 'text-red-400' :
          isRunning ? 'text-[#808080]' :
          'text-[#737373]'
        }`}>
          {meta.icon}
        </span>
        <span className={`text-[12px] truncate ${
          isError ? 'text-red-400' :
          isRunning ? 'text-[#a0a0a0]' :
          'text-[#808080]'
        }`}>
          {meta.label}
        </span>
      </div>
    </motion.div>
  )
}

/**
 * ActionLog - Connected-line timeline of actions
 */
const COLLAPSE_THRESHOLD = 5

export function ActionLog({ toolCalls, isLoading, className = '' }: ActionLogProps) {
  const [expanded, setExpanded] = useState(false)
  const [recentlyFinished, setRecentlyFinished] = useState(false)
  const wasLoadingRef = useRef(isLoading)

  // Keep log expanded for 3s after stream finishes so user can see what happened
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      setRecentlyFinished(true)
      const timer = setTimeout(() => setRecentlyFinished(false), 3000)
      return () => clearTimeout(timer)
    }
    wasLoadingRef.current = isLoading
  }, [isLoading])

  if (toolCalls.length === 0 && !isLoading) return null

  // For reads, collapse into a single "Explore - N files" entry when > 2
  const reads = toolCalls.filter(tc => tc.name === 'readFile')
  const nonReads = toolCalls.filter(tc => tc.name !== 'readFile')

  const displayItems: ToolCall[] = []

  if (reads.length > 2) {
    const allComplete = reads.every(tc => tc.status === 'complete')
    displayItems.push({
      id: 'explore-group',
      name: 'listFiles',
      args: { path: `${reads.length} files` },
      status: allComplete ? 'complete' : 'running',
    })
  } else {
    displayItems.push(...reads)
  }

  displayItems.push(...nonReads)

  // Sort by original order
  const originalOrder = toolCalls.map(tc => tc.id)
  displayItems.sort((a, b) => {
    const aIdx = a.id === 'explore-group' ? 0 : originalOrder.indexOf(a.id)
    const bIdx = b.id === 'explore-group' ? 0 : originalOrder.indexOf(b.id)
    return aIdx - bIdx
  })

  // Collapse completed actions when there are many, but keep expanded during loading and briefly after
  const shouldCollapse = !isLoading && !recentlyFinished && displayItems.length > COLLAPSE_THRESHOLD && !expanded
  const visibleItems = shouldCollapse ? displayItems.slice(-3) : displayItems
  const hiddenCount = shouldCollapse ? displayItems.length - 3 : 0

  return (
    <div className={`py-1 ${className}`}>
      {/* Loading placeholder */}
      {isLoading && displayItems.length === 0 && (
        <div className="flex items-center gap-2.5 pl-4 py-0.5">
          <motion.div
            className="w-[7px] h-[7px] rounded-full bg-[#808080]"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="text-[12px] text-[#8c8c8c]">Moving through the build...</span>
        </div>
      )}

      {/* Collapsed summary */}
      {hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-2 pl-4 py-0.5 text-[11px] text-[#606060] hover:text-[#909090] transition-colors"
        >
          <div className="w-[7px] h-[7px] rounded-full bg-[#252525]" />
          <span>Show {hiddenCount} earlier step{hiddenCount !== 1 ? 's' : ''}</span>
        </button>
      )}

      {visibleItems.map((tc, i) => (
        <ActionItem
          key={tc.id}
          toolCall={tc}
          isLast={i === visibleItems.length - 1}
        />
      ))}
    </div>
  )
}

/**
 * Compact inline action indicator (for headers)
 */
export function ActionIndicator({ toolCalls, isLoading }: { toolCalls: ToolCall[]; isLoading: boolean }) {
  const running = toolCalls.filter(tc => tc.status === 'running').length
  const completed = toolCalls.filter(tc => tc.status === 'complete').length
  const errors = toolCalls.filter(tc => tc.status === 'error').length
  
  if (!isLoading && toolCalls.length === 0) return null
  
  return (
    <div className="flex items-center gap-2 text-[11px]">
      {isLoading && running > 0 && (
        <div className="flex items-center gap-1.5 text-[#606060]">
          <motion.div
            className="w-1.5 h-1.5 rounded-full bg-[#808080]"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span>{running} running</span>
        </div>
      )}
      {completed > 0 && (
        <div className="flex items-center gap-1 text-[#737373]">
          <Check className="w-3 h-3" />
          <span>{completed}</span>
        </div>
      )}
      {errors > 0 && (
        <div className="flex items-center gap-1 text-red-400">
          <AlertCircle className="w-3 h-3" />
          <span>{errors}</span>
        </div>
      )}
    </div>
  )
}
