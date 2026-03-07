'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { ProjectTypeSelector } from './ProjectTypeSelector'
import { useBuilderStore } from '@/store/builder'
import { useInvariantCount } from '@/store/governance'
import { FileExplorerSkeleton } from '@/components/ui/skeletons'

const FileExplorer = dynamic(() => import('./FileExplorer'), {
  loading: () => <FileExplorerSkeleton rows={8} />,
})

const NeuralTimeline = dynamic(() => import('./NeuralTimeline'), {
  loading: () => <FileExplorerSkeleton rows={6} />,
})

const CapabilitiesPanel = dynamic(
  () => import('./CapabilitiesPanel').then((module) => module.CapabilitiesPanel),
  { loading: () => <FileExplorerSkeleton rows={4} /> }
)

const ProtectedPanel = dynamic(
  () => import('./ProtectedPanel').then((module) => module.ProtectedPanel),
  { loading: () => <FileExplorerSkeleton rows={6} /> }
)

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

type SidebarTab = 'files' | 'activity' | 'protected'

/**
 * Sidebar - Emergent-style minimal file explorer
 */
export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('files')
  const { projectType, files } = useBuilderStore()
  const invariantCount = useInvariantCount()
  const builderLabel = projectType === 'mobile' ? 'iOS app' : 'Web app'
  
  return (
    <motion.aside
      className="h-full bg-[#050505]/95 border-r border-white/[0.09] backdrop-blur-xl flex flex-col"
      animate={{ width: collapsed ? 52 : 260 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* Header */}
      <div className="h-11 border-b border-white/[0.08] flex items-center px-2 shrink-0">
        <AnimatePresence mode="wait">
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 min-w-0"
            >
              <div className="min-w-0">
                <p className="truncate text-[10px] font-medium uppercase tracking-[0.18em] text-[#8d8d8d]">Workspace</p>
                <p className="truncate text-[12px] text-[#e2e2e2]">Project files</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        <button
          onClick={onToggle}
          className="w-7 h-7 flex items-center justify-center text-[#5e5e5e] hover:text-[#d1d1d1] hover:bg-white/[0.06] rounded-md transition-colors ml-auto"
        >
          <svg 
            className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
      </div>

      {/* Project Type Selector */}
      {!collapsed && (
        <div className="px-2 py-2 border-b border-white/[0.08]">
          <ProjectTypeSelector compact />
        </div>
      )}

      {!collapsed && (
        <div className="mx-2 mt-2 overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.035]">
          <div className="border-b border-white/[0.08] px-3 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#808080]">Project</p>
            <p className="mt-1 text-[12px] font-medium text-[#f3f3f3]">{builderLabel}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[#7d7d7d]">
              Keep an eye on your files and checks while Torbit builds.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-white/[0.06]">
            <div className="bg-[#070707] px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[#727272]">Files</p>
              <p className="mt-1 text-[15px] font-semibold text-[#e8e8e8]">{files.length}</p>
            </div>
            <div className="bg-[#070707] px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[#727272]">Checks</p>
              <p className={`mt-1 text-[15px] font-semibold ${invariantCount > 0 ? 'text-emerald-300' : 'text-[#8a8a8a]'}`}>
                {invariantCount}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col pt-2">
        {!collapsed && (
          <div className="px-2 pb-2">
            <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
              <TabButton
                active={activeTab === 'files'}
                onClick={() => setActiveTab('files')}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
                Files
              </TabButton>
              <TabButton
                active={activeTab === 'activity'}
                onClick={() => setActiveTab('activity')}
                >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                </svg>
                Flow
              </TabButton>
              <TabButton
                active={activeTab === 'protected'}
                onClick={() => setActiveTab('protected')}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
                Checks
                {invariantCount > 0 && (
                  <span className="text-[9px] text-emerald-500/75 tabular-nums">{invariantCount}</span>
                )}
              </TabButton>
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {!collapsed && (
            <motion.div
              key={activeTab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1 overflow-hidden"
            >
              {activeTab === 'files' && <FileExplorer />}
              {activeTab === 'activity' && <NeuralTimeline />}
              {activeTab === 'protected' && <ProtectedPanel />}
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Capabilities Panel - Only show when mobile and not collapsed */}
        {!collapsed && projectType === 'mobile' && (
          <CapabilitiesPanel />
        )}
        
        {/* Collapsed state icons */}
        {collapsed && (
          <div className="flex flex-col items-center gap-1 pt-2">
            <button
              onClick={() => { onToggle(); setActiveTab('files'); }}
              className={`relative w-10 h-10 flex items-center justify-center hover:text-[#d0d0d0] hover:bg-white/[0.06] rounded-xl transition-all ${
                activeTab === 'files' ? 'text-[#e0e0e0] bg-white/[0.06]' : 'text-[#5e5e5e]'
              }`}
              title="Files"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              {activeTab === 'files' && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-[#c0c0c0] rounded-r" />}
            </button>
            <button
              onClick={() => { onToggle(); setActiveTab('activity'); }}
              className={`relative w-10 h-10 flex items-center justify-center hover:text-[#d0d0d0] hover:bg-white/[0.06] rounded-xl transition-all ${
                activeTab === 'activity' ? 'text-[#e0e0e0] bg-white/[0.06]' : 'text-[#5e5e5e]'
              }`}
              title="Flow"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
              {activeTab === 'activity' && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-[#c0c0c0] rounded-r" />}
            </button>
            <button
              onClick={() => { onToggle(); setActiveTab('protected'); }}
              className={`relative w-10 h-10 flex items-center justify-center hover:text-[#d0d0d0] hover:bg-white/[0.06] rounded-xl transition-all ${
                activeTab === 'protected' ? 'text-[#e0e0e0] bg-white/[0.06]' : 'text-[#5e5e5e]'
              }`}
              title="Checks"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              {invariantCount > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-emerald-500/60 rounded-full" />
              )}
              {activeTab === 'protected' && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-[#c0c0c0] rounded-r" />}
            </button>
          </div>
        )}
      </div>
    </motion.aside>
  )
}

// Emergent-style tab button
function TabButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-medium rounded-md transition-all ${
        active
          ? 'bg-white/[0.12] text-[#e2e2e2]'
          : 'text-[#666666] hover:bg-white/[0.06] hover:text-[#a8a8a8]'
      }`}
    >
      {children}
    </button>
  )
}
