'use client'

import { useState, useMemo, useEffect, useCallback, useRef, type KeyboardEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useBuilderStore, ProjectFile } from '@/store/builder'
import { Auditor, AuditStatus } from '@/lib/auditor'
import { FileExplorerSkeleton } from '@/components/ui/skeletons'

interface FileNode {
  name: string
  type: 'file' | 'folder'
  path: string
  file?: ProjectFile
  children?: FileNode[]
}

// Emergent-style file icons
function getFileIcon(filename: string): React.ReactNode {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const iconClass = 'w-3.5 h-3.5'
  
  switch (ext) {
    case 'tsx':
    case 'jsx':
      return (
        <svg className={`${iconClass} text-blue-400`} viewBox="0 0 24 24" fill="currentColor">
          <path d="M14.23 12.004a2.236 2.236 0 0 1-2.235 2.236 2.236 2.236 0 0 1-2.236-2.236 2.236 2.236 0 0 1 2.235-2.236 2.236 2.236 0 0 1 2.236 2.236zm2.648-10.69c-1.346 0-3.107.96-4.888 2.622-1.78-1.653-3.542-2.602-4.887-2.602-.41 0-.783.093-1.106.278-1.375.793-1.683 3.264-.973 6.365C1.98 8.917 0 10.42 0 12.004c0 1.59 1.99 3.097 5.043 4.03-.704 3.113-.39 5.588.988 6.38.32.187.69.275 1.102.275 1.345 0 3.107-.96 4.888-2.624 1.78 1.654 3.542 2.603 4.887 2.603.41 0 .783-.09 1.106-.275 1.374-.792 1.683-3.263.973-6.365C22.02 15.096 24 13.59 24 12.004c0-1.59-1.99-3.097-5.043-4.032.704-3.11.39-5.587-.988-6.38-.318-.184-.688-.277-1.092-.278z"/>
        </svg>
      )
    case 'ts':
      return (
        <svg className={`${iconClass} text-blue-500`} viewBox="0 0 24 24" fill="currentColor">
          <path d="M1.125 0C.502 0 0 .502 0 1.125v21.75C0 23.498.502 24 1.125 24h21.75c.623 0 1.125-.502 1.125-1.125V1.125C24 .502 23.498 0 22.875 0zm17.363 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 0 1 1.306.34v2.458a3.95 3.95 0 0 0-.643-.361 5.093 5.093 0 0 0-.717-.26 5.453 5.453 0 0 0-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 0 0-.623.242c-.17.104-.3.229-.393.374a.888.888 0 0 0-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a3.033 3.033 0 0 1-1.012 1.085 4.38 4.38 0 0 1-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 0 1-1.84-.164 5.544 5.544 0 0 1-1.512-.493v-2.63a5.033 5.033 0 0 0 3.237 1.2c.333 0 .624-.03.872-.09.249-.06.456-.144.623-.25.166-.108.29-.234.373-.38a1.023 1.023 0 0 0-.074-1.089 2.12 2.12 0 0 0-.537-.5 5.597 5.597 0 0 0-.807-.444 27.72 27.72 0 0 0-1.007-.436c-.918-.383-1.602-.852-2.053-1.405-.45-.553-.676-1.222-.676-2.005 0-.614.123-1.141.369-1.582.246-.441.58-.804 1.004-1.089a4.494 4.494 0 0 1 1.47-.629 7.536 7.536 0 0 1 1.77-.201zm-15.113.188h9.563v2.166H9.506v9.646H6.789v-9.646H3.375z"/>
        </svg>
      )
    case 'js':
      return (
        <svg className={`${iconClass} text-yellow-400`} viewBox="0 0 24 24" fill="currentColor">
          <path d="M0 0h24v24H0V0zm22.034 18.276c-.175-1.095-.888-2.015-3.003-2.873-.736-.345-1.554-.585-1.797-1.14-.091-.33-.105-.51-.046-.705.15-.646.915-.84 1.515-.66.39.12.75.42.976.9 1.034-.676 1.034-.676 1.755-1.125-.27-.42-.405-.6-.586-.78-.63-.705-1.469-1.065-2.834-1.034l-.705.089c-.676.165-1.32.525-1.71 1.005-1.14 1.291-.811 3.541.569 4.471 1.365 1.02 3.361 1.244 3.616 2.205.24 1.17-.87 1.545-1.966 1.41-.811-.18-1.26-.586-1.755-1.336l-1.83 1.051c.21.48.45.689.81 1.109 1.74 1.756 6.09 1.666 6.871-1.004.029-.09.24-.705.074-1.65l.046.067zm-8.983-7.245h-2.248c0 1.938-.009 3.864-.009 5.805 0 1.232.063 2.363-.138 2.711-.33.689-1.18.601-1.566.48-.396-.196-.597-.466-.83-.855-.063-.105-.11-.196-.127-.196l-1.825 1.125c.305.63.75 1.172 1.324 1.517.855.51 2.004.675 3.207.405.783-.226 1.458-.691 1.811-1.411.51-.93.402-2.07.397-3.346.012-2.054 0-4.109 0-6.179l.004-.056z"/>
        </svg>
      )
    case 'css':
    case 'scss':
    case 'sass':
      return (
        <svg className={`${iconClass} text-pink-400`} viewBox="0 0 24 24" fill="currentColor">
          <path d="M1.5 0h21l-1.91 21.563L11.977 24l-8.564-2.438L1.5 0zm17.09 4.413L5.41 4.41l.213 2.622 10.125.002-.255 2.716h-6.64l.24 2.573h6.182l-.366 3.523-2.91.804-2.956-.81-.188-2.11h-2.61l.29 3.855L12 19.288l5.373-1.53L18.59 4.414z"/>
        </svg>
      )
    case 'json':
      return (
        <svg className={`${iconClass} text-amber-400`} viewBox="0 0 24 24" fill="currentColor">
          <path d="M5.759 3.975h1.783V5.76H5.759v4.458A1.783 1.783 0 013.975 12a1.783 1.783 0 011.784 1.783v4.459h1.783v1.783H5.759c-.954-.24-1.784-.803-1.784-1.783v-3.567a1.783 1.783 0 00-1.783-1.783H1.3v-1.783h.892a1.783 1.783 0 001.783-1.783V5.759c0-.98.83-1.543 1.784-1.784zm12.482 0c.954.24 1.784.803 1.784 1.784v3.566a1.783 1.783 0 001.783 1.783h.892v1.783h-.892a1.783 1.783 0 00-1.783 1.783v3.567c0 .98-.83 1.543-1.784 1.783h-1.783V18.24h1.783v-4.459A1.783 1.783 0 0120.025 12a1.783 1.783 0 01-1.783-1.783V5.759h-1.783V3.975h1.783z"/>
        </svg>
      )
    case 'md':
    case 'mdx':
      return (
        <svg className={`${iconClass} text-[#737373]`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      )
    default:
      return (
        <svg className={`${iconClass} text-[#525252]`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      )
  }
}

function buildFileTree(files: ProjectFile[]): FileNode[] {
  const root: FileNode[] = []
  
  // Sort files to group by folder
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path))
  
  for (const file of sortedFiles) {
    const parts = file.path.split('/')
    let current = root
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isFile = i === parts.length - 1
      const path = parts.slice(0, i + 1).join('/')
      
      let existing = current.find(n => n.name === part)
      
      if (!existing) {
        existing = {
          name: part,
          type: isFile ? 'file' : 'folder',
          path,
          file: isFile ? file : undefined,
          children: isFile ? undefined : [],
        }
        current.push(existing)
      }
      
      if (!isFile && existing.children) {
        current = existing.children
      }
    }
  }
  
  return root
}

interface FileTreeItemProps {
  node: FileNode
  depth: number
}

function getTreeItems(currentTarget: HTMLElement): HTMLButtonElement[] {
  const treeRoot = currentTarget.closest('[data-file-tree-root="true"]')
  if (!treeRoot) return []

  return Array.from(
    treeRoot.querySelectorAll<HTMLButtonElement>('[data-file-tree-item="true"]')
  )
}

// Audit status indicator orb with animations
function AuditOrb({ status, issueCount }: { status?: AuditStatus; issueCount?: number }) {
  if (!status || status === 'new') return null

  const getOrbStyles = () => {
    switch (status) {
      case 'auditing':
        return {
          bg: 'bg-[#c0c0c0]',
          shadow: 'shadow-[0_0_6px_rgba(192,192,192,0.5)]',
          pulse: true,
        }
      case 'passed':
        return {
          bg: 'bg-emerald-500',
          shadow: 'shadow-[0_0_6px_rgba(16,185,129,0.5)]',
          pulse: false,
        }
      case 'warning':
        return {
          bg: 'bg-amber-400',
          shadow: 'shadow-[0_0_6px_rgba(251,191,36,0.5)]',
          pulse: false,
        }
      case 'error':
        return {
          bg: 'bg-red-500',
          shadow: 'shadow-[0_0_6px_rgba(239,68,68,0.5)]',
          pulse: false,
        }
      default:
        return { bg: 'bg-[#404040]', shadow: '', pulse: false }
    }
  }

  const styles = getOrbStyles()

  const statusLabels: Record<AuditStatus, string> = {
    new: 'New file',
    auditing: 'Auditing file...',
    passed: 'Validation passed',
    warning: `${issueCount || 0} warning${issueCount !== 1 ? 's' : ''}`,
    error: `${issueCount || 0} error${issueCount !== 1 ? 's' : ''}`,
  }

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0 }}
      animate={{ 
        opacity: 1, 
        scale: styles.pulse ? [1, 1.3, 1] : 1,
      }}
      transition={styles.pulse ? { 
        scale: { repeat: Infinity, duration: 1.2, ease: 'easeInOut' },
        opacity: { duration: 0.2 }
      } : { duration: 0.2 }}
      className={`w-1.5 h-1.5 rounded-full ${styles.bg} ${styles.shadow}`}
      title={statusLabels[status]}
      aria-label={statusLabels[status]}
    />
  )
}

function FileTreeItem({ node, depth }: FileTreeItemProps) {
  const [expanded, setExpanded] = useState(true)
  const { activeFileId, setActiveFile, setFileAuditStatus, files } = useBuilderStore()
  const file = node.file
  const isSelected = node.file?.id === activeFileId
  const auditStatus = node.file?.auditStatus
  const issueCount = node.file?.auditIssues?.length || 0

  // Trigger audit when file is new
  useEffect(() => {
    if (file && file.auditStatus === 'new') {
      // Start auditing
      setFileAuditStatus(file.id, 'auditing')
      
      // Convert files to FileContext format
      const fileContexts = files.map(f => ({ path: f.path, content: f.content }))
      const currentFile = { path: file.path, content: file.content }
      
      // Queue the audit
      Auditor.getInstance().queueAudit(file.id, currentFile, fileContexts)
    }
  }, [file, files, setFileAuditStatus])

  // Subscribe to audit results
  useEffect(() => {
    if (!file) return

    const fileId = file.id
    const unsubscribe = Auditor.getInstance().subscribe((id, result) => {
      if (id === fileId) {
        setFileAuditStatus(fileId, result.status, result.issues)
      }
    })

    return unsubscribe
  }, [file, setFileAuditStatus])

  const handleClick = () => {
    if (node.type === 'folder') {
      setExpanded(!expanded)
    } else if (node.file) {
      setActiveFile(node.file.id)
    }
  }

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    const items = getTreeItems(event.currentTarget)
    const currentIndex = items.indexOf(event.currentTarget)
    if (currentIndex < 0) return

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        items[Math.min(currentIndex + 1, items.length - 1)]?.focus()
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        items[Math.max(currentIndex - 1, 0)]?.focus()
        break
      }
      case 'Home': {
        event.preventDefault()
        items[0]?.focus()
        break
      }
      case 'End': {
        event.preventDefault()
        items[items.length - 1]?.focus()
        break
      }
      case 'ArrowRight': {
        if (node.type !== 'folder') return
        event.preventDefault()
        if (!expanded) {
          setExpanded(true)
          return
        }

        const child = items[currentIndex + 1]
        if (child && Number(child.dataset.depth) === depth + 1) {
          child.focus()
        }
        break
      }
      case 'ArrowLeft': {
        event.preventDefault()
        if (node.type === 'folder' && expanded) {
          setExpanded(false)
          return
        }

        for (let index = currentIndex - 1; index >= 0; index -= 1) {
          const candidate = items[index]
          const candidateDepth = Number(candidate.dataset.depth)
          if (candidateDepth < depth) {
            candidate.focus()
            break
          }
        }
        break
      }
      default:
        break
    }
  }, [depth, expanded, node.type])

  return (
    <div>
      <motion.button
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isSelected}
        aria-expanded={node.type === 'folder' ? expanded : undefined}
        data-file-tree-item="true"
        data-depth={depth}
        className={`w-full flex items-center gap-1.5 px-2 py-[5px] text-left transition-all rounded group ${
          isSelected
            ? 'bg-[#0f0f0f] text-[#c0c0c0]'
            : 'text-[#808080] hover:bg-[#080808] hover:text-[#a8a8a8]'
        }`}
        style={{ paddingLeft: `${depth * 10 + 6}px` }}
        whileTap={{ scale: 0.98 }}
      >
        {/* Folder chevron or file icon */}
        <span className="shrink-0 w-3.5 flex items-center justify-center">
          {node.type === 'folder' ? (
            <motion.svg 
              className="w-2.5 h-2.5 text-[#505050]"
              animate={{ rotate: expanded ? 90 : 0 }}
              transition={{ duration: 0.15 }}
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor" 
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </motion.svg>
          ) : (
            getFileIcon(node.name)
          )}
        </span>
        
        {/* Name */}
        <span className="flex-1 truncate text-[11px] font-normal">{node.name}</span>
        
        {/* Audit status orb */}
        <AuditOrb status={auditStatus} issueCount={issueCount} />
      </motion.button>
      
      {/* Children */}
      <AnimatePresence initial={false}>
        {node.type === 'folder' && expanded && node.children && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
          >
            {node.children.map((child) => (
              <FileTreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============================================================================
// Fuzzy File Search (Cmd+P / Ctrl+P)
// ============================================================================

function fuzzyMatch(query: string, target: string): { match: boolean; score: number } {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (q.length === 0) return { match: true, score: 0 }

  let qi = 0
  let score = 0
  let lastMatchIndex = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += (ti === lastMatchIndex + 1) ? 2 : 1 // consecutive matches score higher
      if (ti === 0 || t[ti - 1] === '/' || t[ti - 1] === '.') score += 3 // path boundary bonus
      lastMatchIndex = ti
      qi++
    }
  }

  return { match: qi === q.length, score }
}

function QuickOpenModal({ files, onClose }: { files: ProjectFile[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { setActiveFile } = useBuilderStore()

  const results = useMemo(() => {
    if (!query.trim()) return files.slice(0, 20)
    return files
      .map((f) => ({ file: f, ...fuzzyMatch(query, f.path) }))
      .filter((r) => r.match)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((r) => r.file)
  }, [files, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const selectFile = (file: ProjectFile) => {
    setActiveFile(file.id)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (results[selectedIndex]) selectFile(results[selectedIndex])
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ duration: 0.12 }}
        className="w-[420px] bg-[#0a0a0a] border border-[#1f1f1f] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#151515]">
          <svg className="w-4 h-4 text-[#505050] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files..."
            className="flex-1 bg-transparent text-[13px] text-[#e0e0e0] placeholder-[#404040] outline-none"
          />
          <kbd className="text-[10px] text-[#404040] bg-[#151515] px-1.5 py-0.5 rounded">ESC</kbd>
        </div>
        <div ref={listRef} className="max-h-[320px] overflow-y-auto custom-scrollbar">
          {results.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-[#404040]">No matching files</div>
          ) : (
            results.map((file, i) => (
              <button
                key={file.id}
                onClick={() => selectFile(file)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                  i === selectedIndex ? 'bg-[#151515] text-[#e0e0e0]' : 'text-[#808080] hover:bg-[#0f0f0f]'
                }`}
              >
                <span className="shrink-0">{getFileIcon(file.path.split('/').pop() || '')}</span>
                <span className="flex-1 truncate text-[12px]">{file.path.split('/').pop()}</span>
                <span className="text-[10px] text-[#404040] truncate max-w-[200px]">{file.path}</span>
              </button>
            ))
          )}
        </div>
      </motion.div>
    </div>
  )
}

/**
 * FileExplorer - Emergent-style minimal file tree
 */
export default function FileExplorer() {
  const { files, isGenerating } = useBuilderStore()
  const [quickOpen, setQuickOpen] = useState(false)

  const fileTree = useMemo(() => buildFileTree(files), [files])

  // Cmd+P / Ctrl+P to open quick search
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault()
        setQuickOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  if (files.length === 0) {
    if (isGenerating) {
      return <FileExplorerSkeleton />
    }

    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-9 h-9 mx-auto mb-3 rounded-lg bg-white/[0.02] border border-dashed border-white/[0.08] flex items-center justify-center">
            <svg className="w-4 h-4 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          </div>
          <p className="text-[11px] text-white/30">Generated files will appear here</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        className="h-full overflow-y-auto py-1 custom-scrollbar"
        role="tree"
        aria-label="Project file explorer"
        data-file-tree-root="true"
        data-testid="file-tree"
      >
        {/* Quick search trigger */}
        <button
          onClick={() => setQuickOpen(true)}
          className="w-full flex items-center gap-2 px-3 py-1.5 mb-1 text-[11px] text-[#404040] hover:text-[#707070] transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <span>Search files</span>
          <kbd className="ml-auto text-[10px] text-[#303030] bg-[#0a0a0a] border border-[#1a1a1a] px-1 py-0.5 rounded">⌘P</kbd>
        </button>

        {fileTree.map((node) => (
          <FileTreeItem
            key={node.path}
            node={node}
            depth={0}
          />
        ))}
      </div>

      <AnimatePresence>
        {quickOpen && (
          <QuickOpenModal
            files={files}
            onClose={() => setQuickOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  )
}
