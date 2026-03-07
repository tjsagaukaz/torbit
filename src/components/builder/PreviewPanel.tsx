'use client'

import { Component, useState, useRef, useEffect } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { useBuilderStore } from '@/store/builder'
import { useE2B } from '@/hooks/useE2B'
import { useTerminalStore } from '@/store/terminal'
import { NervousSystem } from '@/lib/nervous-system'
import { IPhoneFrame, BrowserFrame } from './DeviceFrame'
import { DEVICE_PRESETS } from '@/lib/mobile/types'
import { TorbitSpinner, TorbitLogo } from '@/components/ui/TorbitLogo'
import { SafariFallback, SafariBanner } from './SafariFallback'
import type { BuildFailure } from '@/lib/runtime/build-diagnostics'
import { error as logError, info as logInfo, warn as logWarn } from '@/lib/observability/logger.client'

// ============================================================================
// Preview Error Boundary
// ============================================================================

interface PreviewErrorBoundaryProps {
  children: ReactNode
}

interface PreviewErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class PreviewErrorBoundary extends Component<PreviewErrorBoundaryProps, PreviewErrorBoundaryState> {
  state: PreviewErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError('builder.preview.error_boundary_caught', {
      message: error.message,
      componentStack: info.componentStack,
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center bg-[#000000] p-8">
          <div className="text-center max-w-sm">
            <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <h3 className="text-[14px] font-medium text-red-400 mb-1.5">Preview crashed</h3>
            <p className="text-[12px] text-[#505050] mb-4">
              {this.state.error?.message || 'An unexpected error occurred in the preview panel.'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="text-[12px] text-[#808080] hover:text-white border border-[#252525] hover:border-[#404040] rounded-md px-4 py-2 transition-colors"
            >
              Reload preview
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

// ============================================================================
// Device Preset Selector
// ============================================================================

function DevicePresetSelector() {
  const { devicePreset, setDevicePreset } = useBuilderStore()
  const [isOpen, setIsOpen] = useState(false)
  const currentDevice = DEVICE_PRESETS[devicePreset] || DEVICE_PRESETS['iphone-15-pro-max']

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Select mobile device preset"
        className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-[#808080] hover:text-[#a0a0a0] bg-[#050505] border border-[#151515] rounded-md transition-all"
      >
        <span className="text-[#c0c0c0]">{currentDevice.name}</span>
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setIsOpen(false)} 
            />
            {/* Dropdown */}
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full left-0 mt-1 w-48 bg-[#0a0a0a] border border-[#1f1f1f] rounded-lg shadow-xl z-50 overflow-hidden"
            >
              {Object.values(DEVICE_PRESETS).map((device) => (
                <button
                  key={device.id}
                  onClick={() => {
                    setDevicePreset(device.id)
                    setIsOpen(false)
                  }}
                  className={`
                    w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] transition-all
                    ${devicePreset === device.id 
                      ? 'bg-[#c0c0c0]/10 text-[#c0c0c0]' 
                      : 'text-[#808080] hover:bg-[#141414] hover:text-white'
                    }
                  `}
                >
                  <div className="flex-1">
                    <div className="font-medium">{device.name}</div>
                    <div className="text-[10px] text-[#525252]">
                      {device.width} × {device.height}
                    </div>
                  </div>
                  {devicePreset === device.id && (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// Dynamic import Monaco
const CodeEditor = dynamic(() => import('./CodeEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-[#0a0a0a]">
      <div className="flex items-center gap-2.5">
        <motion.div
          className="w-2 h-2 rounded-full bg-blue-500"
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
        <span className="text-[13px] text-[#737373]">Loading editor...</span>
      </div>
    </div>
  ),
})

/**
 * PreviewPanel - Clean, minimal preview with E2B Cloud Sandbox
 * Uses E2B for real Linux environment instead of WebContainer
 */
export default function PreviewPanel() {
  const {
    previewTab,
    previewDevice,
    setPreviewDevice,
    files,
    devicePreset,
    deviceOrientation,
    setDeviceOrientation,
    chatInput,
    isGenerating,
  } = useBuilderStore()
  const { isBooting, isReady, serverUrl, error, buildFailure, requestPreviewRebuild } = useE2B()
  const isSupported = true // E2B is always supported (cloud-based)
  const terminalLines = useTerminalStore((s) => s.lines)
  const [showRuntimeLog, setShowRuntimeLog] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const [designModeActive, setDesignModeActive] = useState(false)
  const [didCopyUrl, setDidCopyUrl] = useState(false)
  const wasBootingRef = useRef(false)
  
  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (!isMounted) return

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

      if (editable || !event.altKey) return

      if (event.key === '1') {
        event.preventDefault()
        setPreviewDevice('desktop')
        return
      }

      if (event.key === '2') {
        event.preventDefault()
        setPreviewDevice('tablet')
        return
      }

      if (event.key === '3') {
        event.preventDefault()
        setPreviewDevice('mobile')
        return
      }

      if (event.key.toLowerCase() === 'l') {
        event.preventDefault()
        setShowRuntimeLog((value) => !value)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isMounted, setPreviewDevice])

  const deviceWidths = {
    desktop: '100%',
    tablet: '768px',
    mobile: '375px',
  }

  const prevLinesLength = useRef(terminalLines.length)
  
  // Auto-expand during boot, auto-collapse after environment verified
  useEffect(() => {
    const hasNewActivity = terminalLines.length > prevLinesLength.current
    prevLinesLength.current = terminalLines.length
    
    // Expand during boot
    if (hasNewActivity && isBooting) {
      wasBootingRef.current = true
      const frameId = requestAnimationFrame(() => {
        setShowRuntimeLog(true)
      })
      return () => cancelAnimationFrame(frameId)
    }
    
    // Auto-collapse 4s after environment is ready (gives time to scan output)
    if (wasBootingRef.current && isReady && !isBooting) {
      wasBootingRef.current = false
      const timeout = setTimeout(() => {
        setShowRuntimeLog(false)
      }, 4000)
      return () => clearTimeout(timeout)
    }
  }, [terminalLines.length, isBooting, isReady])

  const handleCopyUrl = async () => {
    if (!serverUrl || !navigator?.clipboard) return

    try {
      await navigator.clipboard.writeText(serverUrl)
      setDidCopyUrl(true)
      setTimeout(() => setDidCopyUrl(false), 1200)
    } catch (copyError) {
      logWarn('builder.preview.copy_url_failed', {
        message: copyError instanceof Error ? copyError.message : String(copyError),
      })
    }
  }

  const runtimeState = !isMounted
    ? 'Idle'
    : isBooting
      ? 'Securing runtime'
      : serverUrl
        ? 'Live preview'
        : error
          ? 'Needs attention'
          : files.length > 0
            ? 'Artifacts staged'
            : 'Awaiting run'

  const runtimeDetail = error
    ? 'Preview requires intervention before the canvas can render again.'
    : serverUrl
      ? 'Verified output is ready for inspection.'
      : isBooting
        ? 'Booting the remote environment and validating the app.'
        : files.length > 0
          ? 'Build artifacts are ready while the environment finalizes.'
          : 'Start a run to open a live, runtime-backed canvas.'

  const currentDevicePreset = DEVICE_PRESETS[devicePreset] || DEVICE_PRESETS['iphone-15-pro-max']
  const surfaceValue = previewDevice === 'mobile'
    ? `${currentDevicePreset.name} · ${deviceOrientation === 'portrait' ? 'Portrait' : 'Landscape'}`
    : previewDevice === 'tablet'
      ? 'Tablet canvas'
      : 'Desktop canvas'
  const artifactValue = files.length === 0 ? 'No artifacts yet' : `${files.length} artifact${files.length === 1 ? '' : 's'}`
  const monitorValue = showRuntimeLog
    ? `${terminalLines.length} line${terminalLines.length === 1 ? '' : 's'} visible`
    : isGenerating
      ? 'Run in motion'
      : 'Monitor collapsed'

  const handleRefreshPreview = () => {
    const iframe = document.getElementById('webcontainer-preview') as HTMLIFrameElement | null
    if (iframe) iframe.src = iframe.src
  }

  return (
    <div className="flex-1 flex flex-col bg-[#000000] overflow-hidden">
      {previewTab === 'preview' ? (
        <>
          <div className="border-b border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] backdrop-blur-xl">
            <div className="flex flex-col gap-3 px-4 py-3.5">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 font-medium uppercase tracking-[0.18em] text-[#e8e8e8]">
                      Preview Workbench
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 ${
                      serverUrl
                        ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
                        : error
                          ? 'border-red-400/25 bg-red-500/10 text-red-200'
                          : isBooting
                            ? 'border-amber-300/25 bg-amber-300/10 text-amber-100'
                            : 'border-white/[0.08] bg-black/25 text-[#9a9a9a]'
                    }`}>
                      {runtimeState}
                    </span>
                    <span className="rounded-full border border-cyan-300/15 bg-cyan-300/[0.08] px-2.5 py-1 text-cyan-100/70">
                      {surfaceValue}
                    </span>
                  </div>
                  <h2 className="truncate text-[15px] font-medium tracking-[-0.02em] text-[#f6f6f6]">
                    Torbit Canvas
                  </h2>
                  <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#919191]">
                    Inspect verified output, switch between review surfaces, and monitor runtime health without leaving the build loop.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 xl:justify-end">
                  <button
                    type="button"
                    onClick={() => setShowRuntimeLog(!showRuntimeLog)}
                    aria-label="Toggle runtime log"
                    aria-pressed={showRuntimeLog}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-medium transition-colors ${
                      showRuntimeLog
                        ? 'border-white/[0.14] bg-white/[0.1] text-[#f4f4f4]'
                        : 'border-white/[0.08] bg-white/[0.03] text-[#8f8f8f] hover:border-white/[0.14] hover:text-[#d4d4d4]'
                    }`}
                    title="Toggle runtime log (Alt+L)"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                    {showRuntimeLog ? 'Hide log' : 'Show log'}
                  </button>

                  {serverUrl && (
                    <>
                      <button
                        type="button"
                        onClick={handleRefreshPreview}
                        aria-label="Refresh preview"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] font-medium text-[#8f8f8f] transition-colors hover:border-white/[0.14] hover:text-[#d4d4d4]"
                        title="Refresh preview"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                        </svg>
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => window.open(serverUrl, '_blank', 'noopener,noreferrer')}
                        aria-label="Open preview in new tab"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] font-medium text-[#8f8f8f] transition-colors hover:border-white/[0.14] hover:text-[#d4d4d4]"
                        title="Open preview in new tab"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyUrl}
                        aria-label="Copy preview URL"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] font-medium text-[#8f8f8f] transition-colors hover:border-white/[0.14] hover:text-[#d4d4d4]"
                        title="Copy preview URL"
                      >
                        {didCopyUrl ? 'Copied' : 'Copy URL'}
                      </button>
                    </>
                  )}

                  {error && !serverUrl && (
                    <button
                      type="button"
                      onClick={() => requestPreviewRebuild('manual retry from preview panel')}
                      aria-label="Retry preview boot"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-[11px] font-medium text-red-200 transition-colors hover:bg-red-500/20"
                      title="Retry preview boot"
                    >
                      Retry preview
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                <WorkbenchMetricCard
                  label="Runtime"
                  value={runtimeState}
                  detail={runtimeDetail}
                  tone={serverUrl ? 'success' : error ? 'danger' : isBooting ? 'warning' : 'neutral'}
                />
                <WorkbenchMetricCard
                  label="Review Surface"
                  value={surfaceValue}
                  detail={previewDevice === 'mobile' ? 'Device frame and orientation are active.' : 'Resize and inspect the current canvas mode.'}
                />
                <WorkbenchMetricCard
                  label="Artifacts"
                  value={artifactValue}
                  detail={files.length > 0 ? 'Generated output is staged for preview, inspection, and export.' : 'The canvas will populate once Torbit produces files.'}
                />
                <WorkbenchMetricCard
                  label="Monitor"
                  value={monitorValue}
                  detail={showRuntimeLog ? 'Keep the log open to watch boot, rebuild, and runtime diagnostics.' : 'Expand the runtime log when you need deeper execution detail.'}
                />
              </div>

              <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-0.5 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
                    {(['desktop', 'tablet', 'mobile'] as const).map((device) => (
                      <button
                        key={device}
                        type="button"
                        onClick={() => setPreviewDevice(device)}
                        aria-label={`Switch preview device to ${device}`}
                        className={`rounded-lg px-2.5 py-2 transition-colors ${
                          previewDevice === device
                            ? 'bg-white/[0.12] text-[#f5f5f5]'
                            : 'text-[#666666] hover:text-[#c2c2c2]'
                        }`}
                        title={`${device.charAt(0).toUpperCase() + device.slice(1)} (Alt+${device === 'desktop' ? '1' : device === 'tablet' ? '2' : '3'})`}
                      >
                        {device === 'desktop' && (
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                          </svg>
                        )}
                        {device === 'tablet' && (
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5h3m-6.75 2.25h10.5a2.25 2.25 0 002.25-2.25v-15a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 4.5v15a2.25 2.25 0 002.25 2.25z" />
                          </svg>
                        )}
                        {device === 'mobile' && (
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>

                  {previewDevice === 'mobile' && (
                    <>
                      <DevicePresetSelector />
                      <button
                        type="button"
                        onClick={() => setDeviceOrientation(deviceOrientation === 'portrait' ? 'landscape' : 'portrait')}
                        aria-label="Toggle device orientation"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] font-medium text-[#8f8f8f] transition-colors hover:border-white/[0.14] hover:text-[#d4d4d4]"
                        title="Toggle orientation"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 16.5v-9a3 3 0 013-3h9m3 3v9a3 3 0 01-3 3h-9m-3-3l3.75-3.75m12 0L15.75 16.5" />
                        </svg>
                        {deviceOrientation === 'portrait' ? 'Portrait' : 'Landscape'}
                      </button>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[#727272]">
                  <span className="rounded-full border border-white/[0.08] bg-black/20 px-2.5 py-1">Alt+1/2/3 switches surface</span>
                  <span className="rounded-full border border-white/[0.08] bg-black/20 px-2.5 py-1">Alt+L toggles runtime log</span>
                </div>
              </div>
            </div>
          </div>

          <div className="relative flex-1 flex flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(89,138,255,0.08),transparent_38%),radial-gradient(circle_at_bottom,rgba(34,197,94,0.06),transparent_32%),#010101]">
            <div className={`relative flex-1 overflow-auto px-4 py-4 ${showRuntimeLog ? 'h-1/2' : ''}`}>
              <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:30px_30px]" />
              <div className="relative flex h-full min-h-[340px] items-center justify-center overflow-hidden rounded-[30px] border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_45%)]" />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/[0.05] to-transparent" />
                <div className="relative flex h-full w-full items-center justify-center overflow-auto p-4 sm:p-6">
                  <PreviewErrorBoundary>
                    <PreviewContent
                      isBooting={isBooting}
                      isReady={isReady}
                      isSupported={isSupported}
                      serverUrl={serverUrl}
                      error={error}
                      buildFailure={buildFailure}
                      previewDevice={previewDevice}
                      deviceWidths={deviceWidths}
                      files={files}
                      devicePreset={devicePreset}
                      deviceOrientation={deviceOrientation}
                      isTyping={chatInput.length > 0}
                      isGenerating={isGenerating}
                      onContinueWithoutExecution={() => setDesignModeActive(true)}
                      designModeActive={designModeActive}
                      onRetryPreview={() => requestPreviewRebuild('manual retry from preview status card')}
                    />
                  </PreviewErrorBoundary>
                </div>
              </div>
            </div>

            <AnimatePresence>
              {showRuntimeLog && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: '40%', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                  className="border-t border-white/[0.08] bg-[#020202] overflow-hidden"
                >
                  <RuntimeLogOutput />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      ) : (
        <CodeEditor />
      )}
    </div>
  )
}

function WorkbenchMetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: string
  detail: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}) {
  const toneClass = tone === 'success'
    ? 'border-emerald-400/20 bg-emerald-400/[0.08]'
    : tone === 'warning'
      ? 'border-amber-300/20 bg-amber-300/[0.08]'
      : tone === 'danger'
        ? 'border-red-400/20 bg-red-500/[0.08]'
        : 'border-white/[0.08] bg-white/[0.03]'

  return (
    <div className={`rounded-2xl border px-3 py-3 ${toneClass}`}>
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#777777]">{label}</p>
      <p className="mt-2 text-[13px] font-medium tracking-[-0.02em] text-[#f2f2f2]">{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-[#8d8d8d]">{detail}</p>
    </div>
  )
}

// ============================================================================
// Preview Content
// ============================================================================

interface PreviewContentProps {
  isBooting: boolean
  isReady: boolean
  isSupported: boolean
  serverUrl: string | null
  error: string | null
  buildFailure: BuildFailure | null
  previewDevice: 'desktop' | 'tablet' | 'mobile'
  deviceWidths: Record<string, string>
  files: { path: string; content: string }[]
  devicePreset: string
  deviceOrientation: 'portrait' | 'landscape'
  isTyping: boolean
  isGenerating: boolean
  onContinueWithoutExecution?: () => void
  designModeActive?: boolean
  onRetryPreview?: () => void
}

function PreviewContent({
  isBooting,
  isReady,
  isSupported,
  serverUrl,
  error,
  buildFailure,
  previewDevice,
  deviceWidths,
  files,
  devicePreset,
  deviceOrientation,
  isTyping,
  isGenerating,
  onContinueWithoutExecution,
  designModeActive,
  onRetryPreview,
}: PreviewContentProps) {
  const [isMounted, setIsMounted] = useState(false)
  const [showVerified, setShowVerified] = useState(false)
  const prevServerUrl = useRef<string | null>(null)
  
  useEffect(() => {
    setIsMounted(true)
  }, [])
  
  // Verification Reveal Moment - brief pause when server becomes ready
  useEffect(() => {
    if (serverUrl && !prevServerUrl.current) {
      // Server just became ready - show verification moment
      setShowVerified(true)
      const timeout = setTimeout(() => {
        setShowVerified(false)
      }, 800) // Brief pause before showing preview
      return () => clearTimeout(timeout)
    }
    prevServerUrl.current = serverUrl
  }, [serverUrl])
  
  if (!isMounted) {
    return <StatusCard icon="loading" title="Loading..." subtitle="Initializing preview" />
  }
  
  // Safari / Unsupported browser - show honest fallback gate
  if (!isSupported && !designModeActive) {
    return (
      <SafariFallback 
        onContinue={onContinueWithoutExecution}
      />
    )
  }
  
  // Design mode active - user chose to continue without live execution
  if (!isSupported && designModeActive) {
    return (
      <DesignModePreview 
        files={files}
        isGenerating={isGenerating}
      />
    )
  }

  if (error) {
    const isE2BDisabled =
      error.includes('E2B_API_KEY not configured') ||
      error.includes('Live preview is disabled')

    if (isE2BDisabled) {
      return (
        <StatusCard
          icon="empty"
          title="Live preview unavailable"
          subtitle="Set E2B_API_KEY to enable runtime preview. Code generation still works."
        />
      )
    }

    const errorTitle = buildFailure
      ? (
        buildFailure.category === 'infra'
          ? 'Infrastructure verification failed'
          : buildFailure.category === 'dependency'
            ? 'Dependency resolution failed'
            : buildFailure.category === 'code'
              ? 'Runtime build failed'
              : 'Verification failed'
      )
      : 'Verification failed'

    const errorSubtitle = buildFailure
      ? `${buildFailure.command ? `Command: ${buildFailure.command}. ` : ''}${buildFailure.actionableFix}`
      : 'Check runtime log for details'

    const errorDetail = buildFailure?.exactLogLine || error

    return (
      <StatusCard 
        icon="error" 
        title={errorTitle}
        subtitle={errorSubtitle}
        detail={errorDetail}
        actionLabel="Retry preview"
        onAction={onRetryPreview}
      />
    )
  }

  if (isBooting) {
    return (
      <StatusCard 
        icon="loading" 
        title="Verifying environment" 
        subtitle="Establishing secure runtime"
      />
    )
  }

  // Verification Reveal Moment - brief pause with checkmark
  if (showVerified && serverUrl) {
    return (
      <motion.div 
        className="text-center"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <motion.div 
          className="w-12 h-12 mx-auto mb-4 rounded-full bg-white/[0.05] border border-white/[0.1] flex items-center justify-center"
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <motion.svg 
            className="w-5 h-5 text-white/60" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor" 
            strokeWidth={2}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </motion.svg>
        </motion.div>
        <p className="text-[13px] text-white/50">Verified</p>
      </motion.div>
    )
  }

  if (serverUrl) {
    return (
      <LivePreviewFrame
        serverUrl={serverUrl}
        previewDevice={previewDevice}
        deviceWidths={deviceWidths}
        devicePreset={devicePreset}
        deviceOrientation={deviceOrientation}
      />
    )
  }

  if (isReady && files.length > 0) {
    return (
      <StatusCard 
        icon="loading" 
        title="Validating runtime" 
        subtitle={`${files.length} artifacts staged`}
      />
    )
  }

  // Show "Preparing preview..." when user is typing or generating
  if (isTyping || isGenerating) {
    return (
      <StatusCard 
        icon="loading" 
        title="Preparing preview" 
        subtitle="Output will appear here"
      />
    )
  }

  // Expectation Panel - show what will appear here
  return <ExpectationPanel />
}

// Expectation Panel - Premium minimal design showing what will appear
function ExpectationPanel() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 text-center">
      <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px]">
        <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 font-medium uppercase tracking-[0.16em] text-[#efefef]">
          Canvas Standing By
        </span>
        <span className="rounded-full border border-cyan-300/15 bg-cyan-300/[0.08] px-2.5 py-1 text-cyan-100/75">
          Runtime-backed verification
        </span>
        <span className="rounded-full border border-white/[0.08] bg-black/25 px-2.5 py-1 text-[#8a8a8a]">
          Device-aware review
        </span>
      </div>

      <div className="w-full rounded-[30px] border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.35)]">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[24px] border border-white/[0.07] bg-black/30 p-5 text-left">
            <div className="mb-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[#7e7e7e]">
              <span className="inline-flex h-2 w-2 rounded-full bg-[#8a8a8a]" />
              Preview Theater
            </div>

            <div className="relative overflow-hidden rounded-[22px] border border-white/[0.08] bg-[#050505]">
              <div className="flex h-10 items-center gap-1.5 border-b border-white/[0.06] px-4">
                <div className="h-2 w-2 rounded-full bg-white/[0.12]" />
                <div className="h-2 w-2 rounded-full bg-white/[0.08]" />
                <div className="h-2 w-2 rounded-full bg-white/[0.08]" />
                <div className="ml-3 h-2.5 w-32 rounded-full bg-white/[0.06]" />
              </div>
              <div className="grid gap-3 p-4 md:grid-cols-[0.9fr_1.1fr]">
                <div className="space-y-3">
                  <div className="h-24 rounded-2xl bg-white/[0.04]" />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="h-16 rounded-2xl bg-white/[0.035]" />
                    <div className="h-16 rounded-2xl bg-white/[0.035]" />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="h-3 w-4/5 rounded-full bg-white/[0.08]" />
                  <div className="h-3 w-full rounded-full bg-white/[0.05]" />
                  <div className="h-3 w-2/3 rounded-full bg-white/[0.05]" />
                  <div className="grid grid-cols-3 gap-3 pt-2">
                    <div className="h-20 rounded-2xl bg-white/[0.035]" />
                    <div className="h-20 rounded-2xl bg-white/[0.035]" />
                    <div className="h-20 rounded-2xl bg-white/[0.035]" />
                  </div>
                </div>
              </div>
            </div>

            <h3 className="mt-5 text-[20px] font-medium tracking-[-0.03em] text-[#f5f5f5]">
              A live, review-ready product canvas will appear here.
            </h3>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[#989898]">
              Torbit stages the output here once files, runtime boot, and verification pass far enough to make the artifact worth reviewing.
            </p>
          </div>

          <div className="grid gap-3 text-left">
            <div className="rounded-[24px] border border-white/[0.07] bg-white/[0.03] p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#777777]">What You Get</p>
              <p className="mt-2 text-[15px] font-medium tracking-[-0.02em] text-[#f3f3f3]">Verified, device-aware output</p>
              <p className="mt-1 text-[12px] leading-relaxed text-[#8f8f8f]">
                Review the actual rendered artifact across desktop, tablet, and mobile modes instead of reading generated code in isolation.
              </p>
            </div>
            <div className="rounded-[24px] border border-white/[0.07] bg-white/[0.03] p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#777777]">What Torbit Checks</p>
              <ul className="mt-2 space-y-2 text-[12px] text-[#cfcfcf]">
                <li className="rounded-2xl border border-white/[0.06] bg-black/25 px-3 py-2">Runtime boot, rebuild health, and error visibility</li>
                <li className="rounded-2xl border border-white/[0.06] bg-black/25 px-3 py-2">Responsive review surfaces and device framing</li>
                <li className="rounded-2xl border border-white/[0.06] bg-black/25 px-3 py-2">Export-ready output once the build loop lands</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Design Mode Preview - For Safari/unsupported browsers
// ============================================================================

interface DesignModePreviewProps {
  files: { path: string; content: string }[]
  isGenerating: boolean
}

function DesignModePreview({ files, isGenerating }: DesignModePreviewProps) {
  return (
    <div className="h-full flex flex-col">
      {/* Design Mode Banner */}
      <SafariBanner />
      
      {/* Design Mode Content */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          {isGenerating ? (
            <>
              <TorbitSpinner size="xl" speed="normal" />
              <h3 className="text-[14px] font-medium text-white mt-6 mb-2">
                Generating code
              </h3>
              <p className="text-[12px] text-[#606060]">
                Code will appear in the file tree when complete
              </p>
            </>
          ) : files.length > 0 ? (
            <>
              {/* Success state - files generated */}
              <div className="w-16 h-16 mx-auto mb-6 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-[14px] font-medium text-white mb-2">
                {files.length} artifact{files.length !== 1 ? 's' : ''} ready
              </h3>
              <p className="text-[12px] text-[#606060] mb-6">
                Review in Code tab or export to run locally
              </p>
              <div className="flex items-center justify-center gap-3">
                <div className="flex items-center gap-2 px-3 py-2 bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg text-[12px] text-[#808080]">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                  </svg>
                  View in Code tab
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg text-[12px] text-[#808080]">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Export project
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Empty state */}
              <TorbitLogo size="xl" variant="muted" />
              <h3 className="text-[14px] font-medium text-[#606060] mt-6 mb-2">
                Design mode active
              </h3>
              <p className="text-[12px] text-[#404040]">
                Start a run - code will appear in the file tree
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Status card component - Premium minimal design with TORBIT branding
function StatusCard({ 
  icon, 
  title, 
  subtitle,
  detail,
  actionLabel,
  onAction,
}: { 
  icon: 'loading' | 'error' | 'empty'
  title: string
  subtitle: string
  detail?: string
  actionLabel?: string
  onAction?: () => void
}) {
  const statusLabel = icon === 'loading' ? 'Runtime in progress' : icon === 'error' ? 'Needs intervention' : 'Standing by'

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="rounded-[30px] border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_46%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-6 text-left shadow-[0_24px_80px_rgba(0,0,0,0.42)] sm:p-7">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="shrink-0">
            {icon === 'loading' ? (
              <div className="flex h-16 w-16 items-center justify-center rounded-[22px] border border-white/[0.08] bg-white/[0.04]">
                <TorbitSpinner size="xl" speed="normal" />
              </div>
            ) : icon === 'error' ? (
              <div className="flex h-16 w-16 items-center justify-center rounded-[22px] border border-red-400/25 bg-red-500/10">
                <svg className="h-6 w-6 text-red-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-[22px] border border-white/[0.08] bg-white/[0.03]">
                <TorbitLogo size="xl" variant="muted" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 font-medium uppercase tracking-[0.16em] text-[#efefef]">
                Torbit Runtime
              </span>
              <span className={`rounded-full border px-2.5 py-1 ${
                icon === 'loading'
                  ? 'border-amber-300/20 bg-amber-300/[0.08] text-amber-100'
                  : icon === 'error'
                    ? 'border-red-400/20 bg-red-500/[0.08] text-red-200'
                    : 'border-white/[0.08] bg-black/25 text-[#9a9a9a]'
              }`}>
                {statusLabel}
              </span>
            </div>

            <h3 className={`text-[22px] font-medium tracking-[-0.03em] ${
              icon === 'error' ? 'text-red-100' : 'text-[#f4f4f4]'
            }`}>
              {title}
            </h3>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[#9b9b9b]">{subtitle}</p>

            {detail && (
              <div className="mt-4 rounded-[20px] border border-white/[0.08] bg-black/30 p-4">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#6f6f6f]">Diagnostic detail</p>
                <p className="font-mono text-[11px] leading-relaxed text-[#b0b0b0]">{detail}</p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-[#cfcfcf]">
              <span className="rounded-full border border-white/[0.08] bg-black/25 px-3 py-1.5">Verified output stays in this canvas</span>
              <span className="rounded-full border border-white/[0.08] bg-black/25 px-3 py-1.5">Runtime log captures boot and rebuild evidence</span>
            </div>

            {actionLabel && onAction && (
              <button
                type="button"
                onClick={onAction}
                className={`mt-5 inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-[12px] font-medium transition-colors ${
                  icon === 'error'
                    ? 'border-red-400/25 bg-red-500/10 text-red-200 hover:bg-red-500/20'
                    : 'border-white/[0.1] bg-white/[0.05] text-[#e5e5e5] hover:border-white/[0.16]'
                }`}
              >
                {actionLabel}
              </button>
            )}

            {icon === 'loading' && (
              <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div
                  className="h-full bg-[linear-gradient(90deg,rgba(255,255,255,0.08),rgba(255,255,255,0.7),rgba(255,255,255,0.08))]"
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ width: '40%' }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Live Preview Frame
// ============================================================================

interface LivePreviewFrameProps {
  serverUrl: string
  previewDevice: 'desktop' | 'tablet' | 'mobile'
  deviceWidths: Record<string, string>
  devicePreset?: string
  deviceOrientation?: 'portrait' | 'landscape'
}

function LivePreviewFrame({
  serverUrl,
  previewDevice,
  deviceWidths,
  devicePreset = 'iphone-15-pro-max',
  deviceOrientation = 'portrait',
}: LivePreviewFrameProps) {
  const { setPendingHealRequest, isGenerating } = useBuilderStore()
  const lastAutoHealRef = useRef<number>(0)
  const AUTO_HEAL_DEBOUNCE_MS = 10000
  const displayUrl = (() => {
    try {
      return new URL(serverUrl).host
    } catch {
      return serverUrl.replace(/^https?:\/\//, '')
    }
  })()
  const stageLabel = previewDevice === 'mobile'
    ? `Mobile review · ${deviceOrientation === 'portrait' ? 'Portrait' : 'Landscape'}`
    : previewDevice === 'tablet'
      ? 'Tablet review surface'
      : 'Desktop review surface'
  
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'TORBIT_CONSOLE_ERROR') {
        const errorMessage = event.data.message
        const pain = NervousSystem.analyzeBrowserError(errorMessage)
        if (pain) {
          NervousSystem.dispatchPain(pain)
          
          // Also trigger auto-heal for browser errors
          const now = Date.now()
          if (!isGenerating && (now - lastAutoHealRef.current) > AUTO_HEAL_DEBOUNCE_MS) {
            lastAutoHealRef.current = now
            logInfo('builder.preview.auto_heal_triggered', {
              painType: pain.type,
            })
            setPendingHealRequest({
              error: `${pain.type}: ${pain.message}`,
              suggestion: pain.suggestion || 'Fix the runtime error',
            })
          }
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [setPendingHealRequest, isGenerating])

  const handleIframeLoad = () => {
    try {
      const iframe = document.getElementById('webcontainer-preview') as HTMLIFrameElement
      if (!iframe?.contentWindow) return

      const script = `
        (function() {
          if (window.__torbitConsoleSpy) return;
          window.__torbitConsoleSpy = true;
          
          const originalError = console.error;
          const originalWarn = console.warn;
          
          console.error = function(...args) {
            window.parent.postMessage({ 
              type: 'TORBIT_CONSOLE_ERROR', 
              message: args.map(a => {
                if (a instanceof Error) return a.message + '\\n' + a.stack;
                return String(a);
              }).join(' ')
            }, '*');
            originalError.apply(console, args);
          };
          
          console.warn = function(...args) {
            const msg = args.join(' ');
            if (msg.includes('Hydration') || msg.includes('hydration')) {
              window.parent.postMessage({ 
                type: 'TORBIT_CONSOLE_ERROR', 
                message: msg
              }, '*');
            }
            originalWarn.apply(console, args);
          };
          
          window.addEventListener('error', function(event) {
            window.parent.postMessage({ 
              type: 'TORBIT_CONSOLE_ERROR', 
              message: event.message + ' at ' + event.filename + ':' + event.lineno
            }, '*');
          });
          
          window.addEventListener('unhandledrejection', function(event) {
            window.parent.postMessage({ 
              type: 'TORBIT_CONSOLE_ERROR', 
              message: 'Unhandled Promise Rejection: ' + String(event.reason)
            }, '*');
          });
        })();
      `

      iframe.contentWindow.postMessage({ type: 'TORBIT_INJECT_SPY', script }, '*')
    } catch {
      // Cross-origin restrictions
    }
  }

  // iPhone frame for mobile preview
  if (previewDevice === 'mobile') {
    return (
      <div data-preview-capture="true" className="flex h-full w-full flex-col">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2.5 py-1 text-emerald-100">
              Verified runtime
            </span>
            <span className="rounded-full border border-white/[0.08] bg-black/25 px-2.5 py-1 text-[#8e8e8e]">
              {stageLabel}
            </span>
            <span className="rounded-full border border-white/[0.08] bg-black/25 px-2.5 py-1 text-[#8e8e8e]">
              {displayUrl}
            </span>
          </div>
          <div className="text-[10px] text-[#6f6f6f]">Console monitoring active</div>
        </div>

        <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-[28px] border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_45%),rgba(5,5,5,0.92)] p-5 shadow-[0_28px_80px_rgba(0,0,0,0.4)]">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_40%)]" />
          <motion.div
            animate={{
              rotate: deviceOrientation === 'landscape' ? 90 : 0,
              scale: deviceOrientation === 'landscape' ? 0.82 : 1,
            }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="origin-center"
          >
            <IPhoneFrame preset={devicePreset}>
              <iframe
                id="webcontainer-preview"
                src={serverUrl}
                className="h-full w-full bg-white"
                title="Preview"
                sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"
                onLoad={handleIframeLoad}
              />
            </IPhoneFrame>
          </motion.div>
        </div>
      </div>
    )
  }

  // Browser frame for desktop/tablet
  return (
    <div data-preview-capture="true" className="flex h-full w-full flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2.5 py-1 text-emerald-100">
            Verified runtime
          </span>
          <span className="rounded-full border border-white/[0.08] bg-black/25 px-2.5 py-1 text-[#8e8e8e]">
            {stageLabel}
          </span>
          <span className="rounded-full border border-white/[0.08] bg-black/25 px-2.5 py-1 text-[#8e8e8e]">
            {displayUrl}
          </span>
        </div>
        <div className="text-[10px] text-[#6f6f6f]">Preview is wired to live runtime output</div>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-[28px] border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_45%),rgba(5,5,5,0.92)] p-4 shadow-[0_28px_80px_rgba(0,0,0,0.4)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_40%)]" />
        <motion.div
          style={{ 
            width: previewDevice === 'desktop' ? '100%' : deviceWidths[previewDevice],
            maxWidth: '100%',
            height: '100%',
          }}
          layout
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          className="relative"
        >
          <BrowserFrame url={displayUrl}>
            <iframe 
              id="webcontainer-preview"
              src={serverUrl} 
              className="h-full w-full bg-white"
              title="Preview"
              sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"
              onLoad={handleIframeLoad}
            />
          </BrowserFrame>
        </motion.div>
      </div>
    </div>
  )
}

// ============================================================================
// Runtime Log Output (formerly Terminal)
// ============================================================================

function RuntimeLogOutput() {
  const { lines, clear, isRunning } = useTerminalStore()

  const getLineColor = (type: string) => {
    switch (type) {
      case 'command': return 'text-white/60'
      case 'error': return 'text-red-400/80'
      case 'success': return 'text-white/50'
      case 'warning': return 'text-amber-400/70'
      case 'info': return 'text-white/40'
      default: return 'text-white/30'
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#030303]">
      <div className="flex h-11 items-center justify-between border-b border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] px-4">
        <div className="flex items-center gap-2.5">
          <svg className="h-3.5 w-3.5 text-[#6c6c6c]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-[#cfcfcf]">Runtime Log</span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] text-[#7a7a7a]">
              {lines.length} line{lines.length === 1 ? '' : 's'}
            </span>
          </div>
          {isRunning && (
            <motion.div
              className="h-1.5 w-1.5 rounded-full bg-amber-500"
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            />
          )}
        </div>
        <button
          type="button"
          onClick={clear}
          className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-[#8d8d8d] transition-colors hover:border-white/[0.14] hover:text-[#d2d2d2]"
        >
          Clear
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="relative h-full overflow-auto p-4 font-mono text-[11px] leading-6 custom-scrollbar">
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-md rounded-[24px] border border-white/[0.08] bg-black/25 px-5 py-4 text-center">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#727272]">Quiet runtime</p>
              <p className="mt-2 text-[12px] leading-relaxed text-[#9a9a9a]">
                Boot logs, rebuild output, and runtime diagnostics will stream here once the environment starts doing real work.
              </p>
            </div>
          </div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="flex gap-3">
              <span className="w-7 shrink-0 select-none text-right text-[#363636]">{i + 1}</span>
              <span className={`${getLineColor(line.type)} whitespace-pre-wrap break-words`}>{line.content}</span>
            </div>
          ))
        )}
        </div>
      </div>
    </div>
  )
}
