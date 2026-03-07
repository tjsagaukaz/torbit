'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import { E2BProvider } from '@/providers/E2BProvider'
import { useAuthContext } from '@/providers/AuthProvider'
import { ErrorBoundary, ChatErrorFallback, PreviewErrorFallback } from '@/components/ErrorBoundary'
import BuilderLayout from '@/components/builder/BuilderLayout'
import { TorbitSpinner } from '@/components/ui/TorbitLogo'
import { useBuilderStore } from '@/store/builder'
import { useProjectPresence } from '@/hooks/useProjectPresence'
import { flushQueuedTelemetryEvents, setMetricsProjectContext } from '@/lib/metrics'

const Sidebar = dynamic(() => import('@/components/builder/Sidebar'))
const ChatPanel = dynamic(() => import('@/components/builder/ChatPanel'))
const PreviewPanel = dynamic(() => import('@/components/builder/PreviewPanel'))
const TasksPanel = dynamic(() => import('@/components/builder/TasksPanel'))
const FuelGauge = dynamic(() => import('@/components/builder/FuelGauge'))
const SoundToggle = dynamic(() => import('@/components/builder/SoundToggle'))
const ShipMenu = dynamic(() => import('@/components/builder/ShipMenu'))
const PublishPanel = dynamic(() => import('@/components/builder/PublishPanel').then((module) => module.PublishPanel))
const ScreenshotButton = dynamic(() => import('@/components/builder/ScreenshotButton').then((module) => module.ScreenshotButton))
const UserMenu = dynamic(() => import('@/components/builder/UserMenu').then((module) => module.UserMenu))
const MobileBuilderShell = dynamic(() => import('@/components/builder/MobileBuilderShell'))
const MobileFilesPanel = dynamic(() => import('@/components/builder/MobileFilesPanel'))

export default function BuilderPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuthContext()

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login?next=/builder')
    }
  }, [authLoading, user, router])

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0A0A]">
        <TorbitSpinner size="lg" />
      </div>
    )
  }

  return (
    <E2BProvider>
      <BuilderPageContent />
    </E2BProvider>
  )
}

function BuilderPageContent() {
  const [showTasks, setShowTasks] = useState(false)
  const [chatKey, setChatKey] = useState(0)
  const [previewKey, setPreviewKey] = useState(0)
  const [isMobileLayout, setIsMobileLayout] = useState<boolean | null>(null)

  const {
    initProject,
    setProjectId,
    projectId,
    prompt,
    previewTab,
    setPreviewTab,
    sidebarCollapsed,
    toggleSidebar,
    agents,
    isGenerating,
    projectType,
    files,
  } = useBuilderStore()

  const { members, upsertPresence } = useProjectPresence(projectId)

  const handleChatRetry = useCallback(() => setChatKey((value) => value + 1), [])
  const handlePreviewRetry = useCallback(() => setPreviewKey((value) => value + 1), [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(max-width: 1023px)')
    const updateLayout = () => setIsMobileLayout(mediaQuery.matches)

    updateLayout()
    mediaQuery.addEventListener('change', updateLayout)

    return () => mediaQuery.removeEventListener('change', updateLayout)
  }, [])

  useEffect(() => {
    if (isMobileLayout) {
      setShowTasks(false)
    }
  }, [isMobileLayout])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const storedProjectId = sessionStorage.getItem('torbit_project_id')
    if (storedProjectId && !projectId) {
      setProjectId(storedProjectId)
    }
  }, [projectId, setProjectId])

  useEffect(() => {
    const storedPrompt = sessionStorage.getItem('torbit_prompt')
    const storedCapabilityContext = sessionStorage.getItem('torbit_capability_context')

    if (storedPrompt && !prompt) {
      const enhancedPrompt = storedCapabilityContext
        ? `${storedPrompt}\n\n${storedCapabilityContext}`
        : storedPrompt

      initProject(enhancedPrompt)

      sessionStorage.removeItem('torbit_prompt')
      sessionStorage.removeItem('torbit_platform')
      sessionStorage.removeItem('torbit_capabilities')
      sessionStorage.removeItem('torbit_capability_context')
    }
  }, [initProject, prompt])

  useEffect(() => {
    if (!projectId) return

    let active = true
    upsertPresence('online').catch(e => console.warn('[Presence] Failed to set online:', e))

    const heartbeat = setInterval(() => {
      if (!active) return
      upsertPresence('online').catch(e => console.warn('[Presence] Heartbeat failed:', e))
    }, 30000)

    return () => {
      active = false
      clearInterval(heartbeat)
      upsertPresence('offline').catch(e => console.warn('[Presence] Failed to set offline:', e))
    }
  }, [projectId, upsertPresence])

  useEffect(() => {
    void flushQueuedTelemetryEvents().catch(e => console.warn('[Telemetry] Flush failed:', e))
  }, [])

  useEffect(() => {
    setMetricsProjectContext(projectId)
    return () => {
      setMetricsProjectContext(null)
    }
  }, [projectId])

  const onlineCollaboratorCount = useMemo(
    () => members.filter((member) => member.status !== 'offline' && !member.isCurrentUser).length,
    [members]
  )

  const activeAgent = agents.find((agent) => agent.status === 'working' || agent.status === 'thinking')
  const isWorking = isGenerating || Boolean(activeAgent)
  const missionLabel = projectType === 'mobile' ? 'iOS app' : 'Web app'
  const workspaceTitle = useMemo(() => {
    const normalizedPrompt = prompt.replace(/\s+/g, ' ').trim()
    if (!normalizedPrompt) return 'What do you want to build?'
    return normalizedPrompt.length > 72 ? `${normalizedPrompt.slice(0, 69)}...` : normalizedPrompt
  }, [prompt])
  const collaboratorLabel = onlineCollaboratorCount > 0
    ? `${onlineCollaboratorCount + 1} online`
    : 'Working solo'
  const statusLabel = isWorking ? 'Building now' : 'Ready to build'
  const statusDetail = activeAgent?.currentTask || (isWorking
    ? 'Building your app and checking the preview.'
    : 'Describe the product in plain language to get started.')

  const chatPanel = (
    <ErrorBoundary name="ChatPanel" fallback={<ChatErrorFallback onRetry={handleChatRetry} />}>
      <ChatPanel key={chatKey} />
    </ErrorBoundary>
  )

  const previewPanel = (
    <ErrorBoundary name="PreviewPanel" fallback={<PreviewErrorFallback onRetry={handlePreviewRetry} />}>
      <PreviewPanel key={previewKey} />
    </ErrorBoundary>
  )

  useEffect(() => {
    if (isMobileLayout !== false) return

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

      if (editable) return

      if ((event.metaKey || event.ctrlKey) && event.key === '1') {
        event.preventDefault()
        setPreviewTab('preview')
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key === '2') {
        event.preventDefault()
        setPreviewTab('code')
        return
      }

      if (event.key === 'Escape' && showTasks) {
        event.preventDefault()
        setShowTasks(false)
        return
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        setShowTasks((value) => !value)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isMobileLayout, setPreviewTab, showTasks])

  if (isMobileLayout === null) {
    return (
      <BuilderLayout>
        <div className="flex h-full w-full items-center justify-center bg-[#000000]">
          <TorbitSpinner size="md" />
        </div>
      </BuilderLayout>
    )
  }

  if (isMobileLayout) {
    return (
      <BuilderLayout>
        <MobileBuilderShell
          chatPanel={chatPanel}
          previewPanel={previewPanel}
          filesPanel={<MobileFilesPanel />}
          previewTab={previewTab}
          onPreviewTabChange={setPreviewTab}
          isWorking={isWorking}
          workspaceTitle={workspaceTitle}
          activeAgentLabel={isWorking ? 'Torbit' : null}
          onlineCollaboratorCount={onlineCollaboratorCount}
          headerActions={(
            <>
              <Link
                href="/dashboard"
                aria-label="Go to dashboard"
                className="flex h-7 w-7 items-center justify-center rounded-md text-[#6b6b6b] transition-colors hover:bg-white/[0.06] hover:text-[#fafafa]"
                title="Dashboard"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
                  />
                </svg>
              </Link>
              <FuelGauge />
              <ShipMenu />
              <UserMenu />
            </>
          )}
        />
      </BuilderLayout>
    )
  }

  return (
    <BuilderLayout>
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />

      {chatPanel}

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="relative border-b border-white/[0.08] bg-[#050505]/95 backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          <div className="pointer-events-none absolute inset-x-5 bottom-0 h-px bg-gradient-to-r from-transparent via-white/[0.16] to-transparent" />

          <div className="grid gap-3 px-4 py-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/[0.12] bg-white/[0.05] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[#dedede]">
                  Torbit
                </span>
                <span className="rounded-full border border-cyan-400/15 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-medium text-cyan-200/80">
                  {missionLabel}
                </span>
                <span className="rounded-full border border-white/[0.08] bg-black/30 px-2 py-1 text-[10px] text-[#8b8b8b]">
                  {collaboratorLabel}
                </span>
              </div>

              <div className="min-w-0">
                <p className="truncate text-[18px] font-semibold tracking-[-0.02em] text-[#f5f5f5] sm:text-[22px]">
                  {workspaceTitle}
                </p>
                <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#8c8c8c] sm:text-[12px]">
                  Describe the app you want. Torbit will build it and show the result in the preview.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-end gap-2 text-[11px]">
                <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 ${
                  isWorking
                    ? 'border-emerald-500/20 bg-emerald-500/[0.08] text-[#f2f2f2]'
                    : 'border-white/[0.08] bg-white/[0.035] text-[#e2e2e2]'
                }`}>
                  {isWorking ? <TorbitSpinner size="xs" speed="fast" /> : <span className="h-2 w-2 rounded-full bg-[#4a4a4a]" />}
                  <span>{statusLabel}</span>
                </span>
                <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-[#a7a7a7]">
                  {files.length} {files.length === 1 ? 'file' : 'files'}
                </span>
                <span className="max-w-[220px] truncate text-[#7f7f7f]">{statusDetail}</span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center rounded-2xl border border-white/[0.09] bg-white/[0.04] p-1">
                  <PreviewModeButton
                    label="Preview"
                    shortcut="⌘1"
                    active={previewTab === 'preview'}
                    onClick={() => setPreviewTab('preview')}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.64 0 8.577 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.64 0-8.577-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </PreviewModeButton>
                  <PreviewModeButton
                    label="Code"
                    shortcut="⌘2"
                    active={previewTab === 'code'}
                    onClick={() => setPreviewTab('code')}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                    </svg>
                  </PreviewModeButton>
                </div>

                <div className="relative z-0 flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
                  <button
                    onClick={() => setShowTasks((value) => !value)}
                    className={`flex h-9 items-center gap-2 rounded-xl border px-3 transition-all focus-ring ${
                      showTasks
                        ? 'border-white/[0.2] bg-white/[0.1] text-[#f8f8f8]'
                        : 'border-white/[0.09] bg-white/[0.03] text-[#8d8d8d] hover:border-white/[0.14] hover:text-[#d0d0d0]'
                    }`}
                    title="Tasks (T)"
                    aria-label={showTasks ? 'Close tasks panel' : 'Open tasks panel'}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-[11px] font-medium">Activity</span>
                    <span className="hidden text-[10px] text-[#7a7a7a] md:inline">T</span>
                  </button>
                  <Link
                    href="/dashboard"
                    aria-label="Go to dashboard"
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.03] text-[#676767] transition-all hover:border-white/[0.15] hover:bg-white/[0.05] hover:text-[#fafafa] focus-ring"
                    title="Dashboard"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
                      />
                    </svg>
                  </Link>
                  <div className="hidden sm:block">
                    <ScreenshotButton />
                  </div>
                  <div className="hidden lg:block">
                    <SoundToggle />
                  </div>
                  <FuelGauge />
                  <ShipMenu />
                  <PublishPanel />
                  <UserMenu />
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="relative min-h-0 flex-1">
          {previewPanel}

          {showTasks && (
            <button
              type="button"
              className="absolute inset-0 z-40 bg-black/45 backdrop-blur-[1px]"
              onClick={() => setShowTasks(false)}
              aria-label="Close tasks panel backdrop"
            />
          )}

          <div
            className={`absolute bottom-0 right-0 top-0 z-50 w-[320px] border-l border-white/[0.1] bg-[#090909]/95 shadow-2xl backdrop-blur-sm transition-all duration-200 ${
              showTasks ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-8 opacity-0'
            }`}
            aria-hidden={!showTasks}
          >
            <div className="flex h-full flex-col">
              <div className="flex h-11 items-center justify-between border-b border-white/[0.08] px-4">
                <div>
                  <p className="text-[12px] font-medium text-[#e8e8e8]">Activity</p>
                  <p className="text-[10px] text-[#767676]">Build progress and checks</p>
                </div>
                <button
                  onClick={() => setShowTasks(false)}
                  className="flex h-6 w-6 items-center justify-center rounded text-[#656565] transition-colors hover:bg-white/[0.06] hover:text-[#fafafa]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <TasksPanel />
              </div>
            </div>
          </div>
        </div>
      </div>
    </BuilderLayout>
  )
}

function PreviewModeButton({
  children,
  label,
  shortcut,
  active,
  onClick,
}: {
  children: ReactNode
  label: string
  shortcut: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-xl px-3 py-2 transition-all ${
        active
          ? 'bg-white/[0.12] text-[#fafafa] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
          : 'text-[#727272] hover:bg-white/[0.06] hover:text-[#d6d6d6]'
      }`}
    >
      {children}
      <span className="text-[11px] font-medium">{label}</span>
      <span className="hidden text-[10px] text-[#6c6c6c] lg:inline">{shortcut}</span>
    </button>
  )
}
