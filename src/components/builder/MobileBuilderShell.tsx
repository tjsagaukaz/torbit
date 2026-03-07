'use client'

import { useState, type ReactNode } from 'react'

type MobileBuilderTab = 'chat' | 'preview' | 'files'

interface MobileBuilderShellProps {
  chatPanel: ReactNode
  previewPanel: ReactNode
  filesPanel: ReactNode
  previewTab: 'preview' | 'code'
  onPreviewTabChange: (tab: 'preview' | 'code') => void
  isWorking: boolean
  workspaceTitle: string
  activeAgentLabel?: string | null
  onlineCollaboratorCount: number
  headerActions?: ReactNode
}

export default function MobileBuilderShell({
  chatPanel,
  previewPanel,
  filesPanel,
  previewTab,
  onPreviewTabChange,
  isWorking,
  workspaceTitle,
  activeAgentLabel,
  onlineCollaboratorCount,
  headerActions,
}: MobileBuilderShellProps) {
  const [activeTab, setActiveTab] = useState<MobileBuilderTab>('chat')
  const sessionLabel = onlineCollaboratorCount > 0 ? `${onlineCollaboratorCount + 1} online` : 'Working solo'

  return (
    <div className="flex h-full w-full flex-col bg-[#000000]">
      <header className="border-b border-white/[0.1] bg-[#060606]/95 px-3 py-3 backdrop-blur-xl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[#8a8a8a]">
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 font-medium uppercase tracking-[0.16em] text-[#d7d7d7]">
                Torbit
              </span>
              <span className="rounded-full border border-cyan-300/15 bg-cyan-300/10 px-2 py-1 text-cyan-100/75">
                {isWorking ? 'Building now' : 'Ready'}
              </span>
              <span className="rounded-full border border-white/[0.08] bg-black/25 px-2 py-1 text-[#7b7b7b]">
                {sessionLabel}
              </span>
            </div>
            <p className="truncate text-[14px] font-medium tracking-[-0.02em] text-[#f5f5f5]">{workspaceTitle}</p>
            {activeAgentLabel && (
              <p className="mt-1 truncate text-[10px] text-[#6c6c6c]">{activeAgentLabel} is working on the current build.</p>
            )}
          </div>
          <div className="flex items-center gap-1">{headerActions}</div>
        </div>

        <div className="flex items-center rounded-2xl border border-white/[0.1] bg-white/[0.03] p-1" role="tablist" aria-label="Builder main tabs">
          <MainTabButton active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} label="Chat">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12a8.25 8.25 0 108.25-8.25A8.25 8.25 0 002.25 12z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 12h7.5M8.25 8.25h3.75M8.25 15.75h4.5" />
            </svg>
          </MainTabButton>
          <MainTabButton active={activeTab === 'preview'} onClick={() => setActiveTab('preview')} label="Preview">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.64 0 8.577 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.64 0-8.577-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </MainTabButton>
          <MainTabButton active={activeTab === 'files'} onClick={() => setActiveTab('files')} label="Files">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          </MainTabButton>
        </div>
      </header>

      {activeTab === 'preview' && (
        <div className="flex h-10 items-center gap-1 border-b border-white/[0.1] bg-[#0a0a0a]/95 px-3 backdrop-blur-sm">
          <PreviewTabButton
            active={previewTab === 'preview'}
            onClick={() => onPreviewTabChange('preview')}
            label="Preview"
          />
          <PreviewTabButton
            active={previewTab === 'code'}
            onClick={() => onPreviewTabChange('code')}
            label="Code"
          />
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'chat' && <div className="h-full">{chatPanel}</div>}
        {activeTab === 'preview' && <div className="h-full">{previewPanel}</div>}
        {activeTab === 'files' && <div className="h-full">{filesPanel}</div>}
      </main>

      <nav className="border-t border-white/[0.1] bg-[#090909]/95 px-3 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-1 rounded-2xl border border-white/[0.1] bg-white/[0.03] p-1">
          <FooterTabButton active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} label="Chat" />
          <FooterTabButton active={activeTab === 'preview'} onClick={() => setActiveTab('preview')} label="Preview" />
          <FooterTabButton active={activeTab === 'files'} onClick={() => setActiveTab('files')} label="Files" />
        </div>
      </nav>
    </div>
  )
}

function MainTabButton({
  children,
  active,
  onClick,
  label,
}: {
  children: ReactNode
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
        active ? 'bg-white/[0.12] text-[#fafafa]' : 'text-[#7a7a7a] hover:bg-white/[0.06] hover:text-[#bcbcbc]'
      }`}
    >
      {children}
      {label}
    </button>
  )
}

function PreviewTabButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl px-3 py-1.5 text-[11px] font-medium transition-colors ${
        active ? 'bg-white/[0.12] text-[#fafafa]' : 'text-[#676767] hover:text-[#a7a7a7]'
      }`}
    >
      {label}
    </button>
  )
}

function FooterTabButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl px-3 py-2 text-[11px] font-medium transition-colors ${
        active ? 'bg-white/[0.12] text-[#fafafa]' : 'text-[#757575] hover:bg-white/[0.05] hover:text-[#bdbdbd]'
      }`}
    >
      {label}
    </button>
  )
}
