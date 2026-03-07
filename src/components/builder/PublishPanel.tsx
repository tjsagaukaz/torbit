/**
 * TORBIT Mobile - Publish Panel
 * End-to-end release actions for Xcode, TestFlight, App Store Connect, Android
 */

'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import {
  Rocket,
  Apple,
  Download,
  CheckCircle2,
  Package,
  FileCode,
  Shield,
  Clock,
  ChevronRight,
  X,
  Smartphone,
  TestTube,
  Store,
  AlertTriangle,
} from 'lucide-react'
import { useBuilderStore } from '@/store/builder'
import { generateExportBundle, createExportZip, downloadBlob } from '@/lib/mobile/export'
import { validateProject, generatePodfile, generateEntitlements } from '@/lib/mobile/validation'
import type { ValidationResult } from '@/lib/mobile/validation'
import { DEFAULT_MOBILE_CONFIG } from '@/lib/mobile/types'
import { useBackgroundRuns } from '@/hooks/useBackgroundRuns'
import type { BackgroundRun } from '@/lib/supabase/types'
import { useEscapeToClose } from '@/hooks/useEscapeToClose'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { PreflightChecklist } from './PreflightChecklist'
import { GovernanceResolved } from './governance'
import { TrustLayerCard } from '@/components/governance/TrustLayerCard'
import { TorbitSpinner } from '@/components/ui/TorbitLogo'
import { recordMetric } from '@/lib/metrics/success'
import { error as logError } from '@/lib/observability/logger.client'
import { useGovernanceStore } from '@/store/governance'
import { readApiErrorMessage } from '@/lib/api/error-envelope'

type PublishStatus = 'idle' | 'validating' | 'preflight' | 'processing' | 'complete' | 'error'
type PublishAction = 'xcode' | 'testflight' | 'appstore-connect' | 'android'
type AndroidTrack = 'internal' | 'alpha' | 'beta' | 'production'

interface MobilePipelineDiagnostics {
  expoTokenConfigured: boolean
  appleAppSpecificPasswordConfigured: boolean
  appleApiKeyConfigured: boolean
  iosSubmitAuthConfigured: boolean
  googleServiceAccountConfigured: boolean
  warnings: string[]
}

interface PublishResult {
  action: PublishAction
  runStatus?: BackgroundRun['status']
  backgroundRunId?: string | null
  appName: string
  version: string
  capabilities: string[]
  fileCount: number
  completedAt: string
  message: string
  links: string[]
  androidTrack?: AndroidTrack
}

interface ActionMeta {
  title: string
  description: string
  badge: string
  cta: string
}

interface ActionInlineWarning {
  message: string
  tone: 'warning' | 'error'
}

type ReleaseRailStepState = 'pending' | 'active' | 'complete' | 'error'
interface ReleaseRailStep {
  key: 'requested' | 'reviewing' | 'submitted'
  label: string
  state: ReleaseRailStepState
}

const ACTION_META: Record<PublishAction, ActionMeta> = {
  xcode: {
    title: 'Export for Xcode',
    description: 'Validate and download a store-ready project bundle',
    badge: 'iOS',
    cta: 'Export for Xcode',
  },
  testflight: {
    title: 'TestFlight',
    description: 'Queue iOS build and auto-submit to TestFlight',
    badge: 'iOS',
    cta: 'Queue TestFlight',
  },
  'appstore-connect': {
    title: 'App Store Connect',
    description: 'Queue iOS build and auto-submit to App Store Connect',
    badge: 'iOS',
    cta: 'Submit to App Store Connect',
  },
  android: {
    title: 'Android',
    description: 'Queue Android build and auto-submit to Play Console',
    badge: 'Android',
    cta: 'Queue Android Release',
  },
}

const ANDROID_TRACK_OPTIONS: Array<{ value: AndroidTrack; label: string; hint: string }> = [
  { value: 'internal', label: 'Internal', hint: 'Team QA only' },
  { value: 'alpha', label: 'Alpha', hint: 'Small tester cohort' },
  { value: 'beta', label: 'Beta', hint: 'Broader validation' },
  { value: 'production', label: 'Production', hint: 'Public rollout' },
]

let idempotencyFallbackSequence = 0

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

function generateIdempotencyKey(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return `mobile-release:${globalThis.crypto.randomUUID()}`
  }

  idempotencyFallbackSequence += 1
  return `mobile-release:fallback-${idempotencyFallbackSequence}`
}

function actionToApi(action: PublishAction): 'testflight' | 'appstore-connect' | 'android' | null {
  if (action === 'xcode') return null
  if (action === 'testflight') return 'testflight'
  if (action === 'appstore-connect') return 'appstore-connect'
  return 'android'
}

function buildFailureTitle(action: PublishAction): string {
  if (action === 'testflight') return 'TestFlight Failed'
  if (action === 'appstore-connect') return 'App Store Connect Failed'
  if (action === 'android') return 'Android Pipeline Failed'
  return 'Export Failed'
}

function getActionNextSteps(action: PublishAction, androidTrack?: AndroidTrack): string[] {
  if (action === 'testflight') {
    return [
      'Open the build link and monitor queue status.',
      'Wait for the auto-submit step to complete.',
      'Invite testers in App Store Connect TestFlight.',
    ]
  }

  if (action === 'appstore-connect') {
    return [
      'Open App Store Connect and verify the new build is attached.',
      'Complete metadata, screenshots, and compliance forms.',
      'Submit the version for App Review when QA signs off.',
    ]
  }

  if (action === 'android') {
    const trackLabel = androidTrack || 'internal'
    return [
      `Open Play Console and monitor ${trackLabel} track processing.`,
      `Run smoke tests from ${trackLabel} distribution.`,
      'Promote to alpha/beta/production after QA approval.',
    ]
  }

  return [
    'Unzip and run npm install.',
    'Run npx expo prebuild --platform ios.',
    'Follow README-SIGNING.md for final signing and archive.',
  ]
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function resolveAction(value: unknown): PublishAction | null {
  if (value === 'xcode' || value === 'testflight' || value === 'appstore-connect' || value === 'android') {
    return value
  }
  return null
}

function getReleaseRailAction(run: BackgroundRun): PublishAction | null {
  const metadata = toObject(run.metadata)
  const input = toObject(run.input)
  return resolveAction(metadata?.releaseAction) || resolveAction(input?.action)
}

function formatRunTimestamp(timestamp: string | null): string | null {
  if (!timestamp) return null
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString()
}

function buildReleaseRailSteps(run: BackgroundRun): ReleaseRailStep[] {
  if (run.status === 'queued') {
    return [
      { key: 'requested', label: 'Requested', state: 'complete' },
      { key: 'reviewing', label: 'Reviewing', state: 'pending' },
      { key: 'submitted', label: 'Submitted', state: 'pending' },
    ]
  }

  if (run.status === 'running') {
    return [
      { key: 'requested', label: 'Requested', state: 'complete' },
      { key: 'reviewing', label: 'Reviewing', state: 'active' },
      { key: 'submitted', label: 'Submitted', state: 'pending' },
    ]
  }

  if (run.status === 'succeeded') {
    return [
      { key: 'requested', label: 'Requested', state: 'complete' },
      { key: 'reviewing', label: 'Reviewing', state: 'complete' },
      { key: 'submitted', label: 'Submitted', state: 'complete' },
    ]
  }

  return [
    { key: 'requested', label: 'Requested', state: 'complete' },
    { key: 'reviewing', label: 'Reviewing', state: 'error' },
    { key: 'submitted', label: 'Submitted', state: 'pending' },
  ]
}

function getReleaseRailSummary(run: BackgroundRun): string {
  if (run.status === 'queued') {
    const retryAt = formatRunTimestamp(run.next_retry_at)
    return retryAt
      ? `Queued for retry at ${retryAt}.`
      : 'Queued for worker dispatch.'
  }

  if (run.status === 'running') {
    if (run.cancel_requested) {
      return 'Cancel requested. Waiting for worker checkpoint.'
    }
    return 'Release pipeline is running.'
  }

  if (run.status === 'succeeded') {
    return 'Release was submitted successfully.'
  }

  if (run.status === 'cancelled') {
    return 'Release was cancelled.'
  }

  return run.error_message || 'Release failed.'
}

function getReleaseRailStatusClass(status: BackgroundRun['status']): string {
  if (status === 'running') return 'text-blue-400 bg-blue-500/10 border-blue-500/30'
  if (status === 'queued') return 'text-amber-400 bg-amber-500/10 border-amber-500/30'
  if (status === 'succeeded') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
  if (status === 'cancelled') return 'text-neutral-300 bg-neutral-500/10 border-neutral-500/30'
  return 'text-red-400 bg-red-500/10 border-red-500/30'
}

function getReleaseRailProgressClass(status: BackgroundRun['status']): string {
  if (status === 'failed') return 'bg-red-500'
  if (status === 'cancelled') return 'bg-neutral-500'
  if (status === 'succeeded') return 'bg-emerald-500'
  return 'bg-blue-500'
}

function getReleaseRailStepClass(state: ReleaseRailStepState): string {
  if (state === 'complete') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
  if (state === 'active') return 'border-blue-500/40 bg-blue-500/10 text-blue-300'
  if (state === 'error') return 'border-red-500/40 bg-red-500/10 text-red-300'
  return 'border-neutral-700 bg-neutral-900 text-neutral-500'
}

function getReleaseRunLinks(run: BackgroundRun | null): string[] {
  if (!run) return []
  const output = toObject(run.output)
  const links = output?.links
  if (!Array.isArray(links)) return []
  return links.filter((link): link is string => typeof link === 'string')
}

export function PublishPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [status, setStatus] = useState<PublishStatus>('idle')
  const [selectedAction, setSelectedAction] = useState<PublishAction>('xcode')
  const [androidTrack, setAndroidTrack] = useState<AndroidTrack>('internal')
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
  const [result, setResult] = useState<PublishResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isFirstExport, setIsFirstExport] = useState(false)
  const [diagnostics, setDiagnostics] = useState<MobilePipelineDiagnostics | null>(null)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null)
  const [approvalRequestId, setApprovalRequestId] = useState<string | null>(null)
  const [activeReleaseRunId, setActiveReleaseRunId] = useState<string | null>(null)
  const [releaseRailActionPending, setReleaseRailActionPending] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  const { files, projectType, capabilities, projectName, platforms, projectId } = useBuilderStore()
  const { runs: backgroundRuns, updateRun, dispatchRun } = useBackgroundRuns(isOpen ? projectId : null)
  const approvals = useGovernanceStore((state) => state.approvals)
  const requestApproval = useGovernanceStore((state) => state.requestApproval)
  const recordSignedBundle = useGovernanceStore((state) => state.recordSignedBundle)
  const setGovernanceProjectId = useGovernanceStore((state) => state.setProjectId)

  const isMobile = projectType === 'mobile'
  const hasFiles = files.length > 0

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const exported = localStorage.getItem('torbit_has_exported_mobile')
      setIsFirstExport(!exported)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return

    let cancelled = false
    setDiagnosticsLoading(true)
    setDiagnosticsError(null)

    fetch('/api/ship/mobile', { method: 'GET' })
      .then(async (response) => {
        const payload = await response.json() as {
          success?: boolean
          diagnostics?: MobilePipelineDiagnostics
          error?: string
        }

        if (!response.ok || !payload.success || !payload.diagnostics) {
          throw new Error(payload.error || 'Failed to load pipeline diagnostics.')
        }

        if (!cancelled) {
          setDiagnostics(payload.diagnostics)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setDiagnostics(null)
          setDiagnosticsError(err instanceof Error ? err.message : 'Diagnostics unavailable')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDiagnosticsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [isOpen])

  const config = useMemo(() => ({
    ...DEFAULT_MOBILE_CONFIG,
    appName: projectName || 'MyApp',
    capabilities,
    platforms: platforms.length > 0 ? platforms : DEFAULT_MOBILE_CONFIG.platforms,
  }), [projectName, capabilities, platforms])

  const currentApproval = useMemo(() => {
    if (!approvalRequestId) return null
    return approvals.find((approval) => approval.id === approvalRequestId) || null
  }, [approvalRequestId, approvals])

  const mobileReleaseRuns = useMemo(() => (
    backgroundRuns
      .filter((run) => run.run_type === 'mobile-release')
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  ), [backgroundRuns])

  const activeReleaseRun = useMemo(() => {
    if (activeReleaseRunId) {
      const match = mobileReleaseRuns.find((run) => run.id === activeReleaseRunId)
      if (match) return match
    }

    return mobileReleaseRuns[0] || null
  }, [activeReleaseRunId, mobileReleaseRuns])

  const releaseRailSteps = useMemo(() => (
    activeReleaseRun ? buildReleaseRailSteps(activeReleaseRun) : []
  ), [activeReleaseRun])

  const releaseRailTitle = useMemo(() => {
    if (!activeReleaseRun) return 'Mobile Release'
    const action = getReleaseRailAction(activeReleaseRun)
    return action ? ACTION_META[action].title : 'Mobile Release'
  }, [activeReleaseRun])

  const releaseRailLinks = useMemo(() => getReleaseRunLinks(activeReleaseRun), [activeReleaseRun])

  useEffect(() => {
    if (!isOpen || activeReleaseRunId || mobileReleaseRuns.length === 0) return
    setActiveReleaseRunId(mobileReleaseRuns[0].id)
  }, [activeReleaseRunId, isOpen, mobileReleaseRuns])

  useEffect(() => {
    if (!projectId) return
    setGovernanceProjectId(projectId)
  }, [projectId, setGovernanceProjectId])

  const resetPanel = () => {
    setStatus('idle')
    setSelectedAction('xcode')
    setValidationResult(null)
    setResult(null)
    setError(null)
    setApprovalRequestId(null)
    setActiveReleaseRunId(null)
    setReleaseRailActionPending(false)
  }

  const closePanel = () => {
    setIsOpen(false)
    resetPanel()
  }

  useEscapeToClose(isOpen, closePanel)
  useBodyScrollLock(isOpen)
  useFocusTrap(dialogRef, isOpen)

  if (!isMobile) return null

  const projectFiles = files.map((file) => ({
    path: file.path,
    content: file.content,
  }))

  const handleReleaseRailDispatch = async () => {
    if (!activeReleaseRun) return

    setReleaseRailActionPending(true)
    try {
      await dispatchRun({ runId: activeReleaseRun.id, limit: 1 })
    } catch {
      // Realtime updates reconcile run state; rail controls are best-effort.
    } finally {
      setReleaseRailActionPending(false)
    }
  }

  const handleReleaseRailCancel = async () => {
    if (!activeReleaseRun) return

    setReleaseRailActionPending(true)
    try {
      await updateRun(activeReleaseRun.id, { operation: 'request-cancel' })
    } catch {
      // Realtime updates reconcile run state; rail controls are best-effort.
    } finally {
      setReleaseRailActionPending(false)
    }
  }

  const handleReleaseRailRetry = async () => {
    if (!activeReleaseRun) return

    setReleaseRailActionPending(true)
    try {
      await updateRun(activeReleaseRun.id, {
        operation: 'retry',
        retryAfterSeconds: 10,
      })
      await dispatchRun({ runId: activeReleaseRun.id, limit: 1 })
    } catch {
      // Realtime updates reconcile run state; rail controls are best-effort.
    } finally {
      setReleaseRailActionPending(false)
    }
  }

  const markSuccessfulAction = (action: PublishAction) => {
    if (typeof window !== 'undefined' && isFirstExport) {
      localStorage.setItem('torbit_has_exported_mobile', 'true')
      setIsFirstExport(false)
    }

    if (action === 'xcode') {
      recordMetric('export_downloaded', { exportType: action })
      return
    }

    recordMetric('export_deployed', { exportType: action })
  }

  const runXcodeExport = async (): Promise<PublishResult> => {
    const podfile = generatePodfile(config, config.appName)
    const entitlements = generateEntitlements(config.capabilities, config.bundleId)

    const enhancedFiles = [
      ...projectFiles,
      { path: 'ios/Podfile', content: podfile },
      { path: 'ios/Entitlements.plist', content: entitlements },
    ]

    const bundle = generateExportBundle(enhancedFiles, config)
    const blob = await createExportZip(bundle)
    const filename = `${config.appName.replace(/\s+/g, '-')}-Mobile-Export.zip`
    downloadBlob(blob, filename)

    return {
      action: 'xcode',
      runStatus: 'succeeded',
      appName: config.appName,
      version: config.version,
      capabilities: bundle.metadata.capabilities,
      fileCount: bundle.files.length,
      completedAt: new Date().toLocaleTimeString(),
      message: 'Store-ready mobile export downloaded.',
      links: [],
    }
  }

  const runRemotePipeline = async (action: Exclude<PublishAction, 'xcode'>): Promise<PublishResult> => {
    const apiAction = actionToApi(action)
    if (!apiAction) {
      throw new Error('Invalid mobile pipeline action.')
    }

    if (diagnostics && !diagnostics.expoTokenConfigured) {
      throw new Error('EXPO_TOKEN is missing on the server. Configure it before running remote pipeline actions.')
    }

    if (diagnostics && (action === 'testflight' || action === 'appstore-connect') && !diagnostics.iosSubmitAuthConfigured) {
      throw new Error('Apple submit credentials are missing on the server. Configure App Store submit auth to continue.')
    }

    if (diagnostics && action === 'android' && !diagnostics.googleServiceAccountConfigured) {
      throw new Error('Google Play service account credentials are missing on the server. Configure Android submit auth to continue.')
    }

    const enabledCapabilities = Object.entries(config.capabilities)
      .filter(([, enabled]) => enabled)
      .map(([capability]) => capability)

    const buildResult = (input: {
      message: string
      links?: string[]
      runStatus: BackgroundRun['status']
      backgroundRunId?: string | null
      androidTrackOverride?: AndroidTrack
    }): PublishResult => ({
      action,
      runStatus: input.runStatus,
      backgroundRunId: input.backgroundRunId || null,
      appName: config.appName,
      version: config.version,
      capabilities: enabledCapabilities,
      fileCount: projectFiles.length,
      completedAt: new Date().toLocaleTimeString(),
      message: input.message,
      links: input.links || [],
      androidTrack: action === 'android'
        ? (input.androidTrackOverride || androidTrack)
        : undefined,
    })

    const submitProfile = action === 'android'
      ? `android-${androidTrack}`
      : action === 'testflight'
        ? 'testflight'
        : 'appstore'
    const idempotencyKey = generateIdempotencyKey()
    const runInput = {
      action: apiAction,
      projectName: config.appName,
      files: projectFiles,
      buildProfile: 'production',
      submitProfile,
      androidTrack: action === 'android' ? androidTrack : undefined,
      wait: false,
    }

    let backgroundRunId: string | null = null
    const canQueueBackgroundRun = Boolean(projectId && isUuid(projectId))
    if (canQueueBackgroundRun && projectId) {
      try {
        const enqueueResponse = await fetch('/api/background-runs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectId,
            runType: 'mobile-release',
            input: runInput,
            metadata: {
              releaseAction: action,
              submitProfile,
              androidTrack: action === 'android' ? androidTrack : null,
            },
            idempotencyKey,
            maxAttempts: 3,
            retryable: true,
          }),
        })
        const enqueuePayload = await enqueueResponse.json() as {
          success?: boolean
          run?: { id?: string }
          error?: unknown
        }
        if (!enqueueResponse.ok || !enqueuePayload.success || !enqueuePayload.run?.id) {
          throw new Error(readApiErrorMessage(enqueuePayload.error, 'Failed to queue release run.'))
        }
        backgroundRunId = enqueuePayload.run?.id || null
        if (backgroundRunId) {
          setActiveReleaseRunId(backgroundRunId)
        }
      } catch {
        backgroundRunId = null
      }
    }

    if (!backgroundRunId) {
      const response = await fetch('/api/ship/mobile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(runInput),
      })

      const payload = await response.json() as {
        success?: boolean
        error?: string
        details?: string
        message?: string
        links?: string[]
        output?: string
        androidTrack?: AndroidTrack
      }

      if (!response.ok || !payload.success) {
        const detail = payload.details ? ` ${payload.details}` : ''
        throw new Error(`${payload.error || 'Mobile pipeline failed.'}${detail}`)
      }

      const links = payload.links || []
      if (links.length > 0 && typeof window !== 'undefined') {
        window.open(links[0], '_blank', 'noopener,noreferrer')
      }

      return buildResult({
        runStatus: 'running',
        message: payload.message || 'Mobile pipeline started.',
        links,
        androidTrackOverride: payload.androidTrack || undefined,
      })
    }

    let dispatchPayload: {
      success?: boolean
      error?: unknown
      outcomes?: Array<{
        runId: string
        status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
        retried: boolean
        attemptCount: number
        progress: number
        output: Record<string, unknown> | null
        nextRetryAt: string | null
        startedAt: string | null
        finishedAt: string | null
        error?: string
      }>
    } | null = null

    try {
      const dispatchResponse = await fetch('/api/background-runs/dispatch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          runId: backgroundRunId,
          limit: 1,
        }),
      })

      const payload = await dispatchResponse.json() as {
        success?: boolean
        error?: unknown
        outcomes?: Array<{
          runId: string
          status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
          retried: boolean
          attemptCount: number
          progress: number
          output: Record<string, unknown> | null
          nextRetryAt: string | null
          startedAt: string | null
          finishedAt: string | null
          error?: string
        }>
      }

      if (!dispatchResponse.ok || !payload.success) {
        return buildResult({
          runStatus: 'queued',
          backgroundRunId,
          message: 'Release queued. Worker will continue the pipeline in the background.',
        })
      }

      dispatchPayload = payload
    } catch {
      return buildResult({
        runStatus: 'queued',
        backgroundRunId,
        message: 'Release queued. Worker will continue the pipeline in the background.',
      })
    }

    const outcome = dispatchPayload.outcomes?.find((item) => item.runId === backgroundRunId)
      || dispatchPayload.outcomes?.[0]

    if (!outcome) {
      return buildResult({
        runStatus: 'queued',
        backgroundRunId,
        message: 'Release queued. Track live status in Release Rail.',
      })
    }

    if (outcome.status === 'failed' || outcome.status === 'cancelled') {
      throw new Error(outcome.error || 'Mobile pipeline failed.')
    }

    if (outcome.status === 'queued') {
      const retryHint = outcome.retried && outcome.nextRetryAt
        ? ` Next retry at ${new Date(outcome.nextRetryAt).toLocaleTimeString()}.`
        : ''

      return buildResult({
        runStatus: 'queued',
        backgroundRunId,
        message: (outcome.error || 'Release queued. Track live status in Release Rail.') + retryHint,
      })
    }

    if (outcome.status === 'running') {
      return buildResult({
        runStatus: 'running',
        backgroundRunId,
        message: 'Release pipeline is running. Track live status in Release Rail.',
      })
    }

    const output = outcome.output && typeof outcome.output === 'object'
      ? outcome.output
      : {}

    const links = Array.isArray(output.links)
      ? output.links.filter((link): link is string => typeof link === 'string')
      : []

    if (links.length > 0 && typeof window !== 'undefined') {
      window.open(links[0], '_blank', 'noopener,noreferrer')
    }

    const outputMessage = typeof output.message === 'string'
      ? output.message
      : 'Mobile pipeline started.'
    const outputAndroidTrack = (
      output.androidTrack === 'internal'
      || output.androidTrack === 'alpha'
      || output.androidTrack === 'beta'
      || output.androidTrack === 'production'
    )
      ? output.androidTrack
      : undefined

    return buildResult({
      runStatus: 'succeeded',
      backgroundRunId,
      message: outputMessage,
      links,
      androidTrackOverride: outputAndroidTrack,
    })

  }

  const signAndRecordBundle = async (publishResult: PublishResult) => {
    if (!projectId) return

    try {
      const response = await fetch('/api/governance/sign-bundle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId,
          action: publishResult.action,
          artifactCount: publishResult.fileCount,
          approvalRequestId: approvalRequestId || undefined,
          metadata: {
            appName: publishResult.appName,
            version: publishResult.version,
            links: publishResult.links,
            androidTrack: publishResult.androidTrack,
          },
        }),
      })

      const payload = await response.json() as {
        success?: boolean
        signedBundle?: {
          action: string
          bundleHash: string
          signature: string
          algorithm: string
          keyId: string
          artifactCount: number
        }
      }

      if (!response.ok || !payload.success || !payload.signedBundle) {
        return
      }

      recordSignedBundle({
        action: payload.signedBundle.action,
        bundleHash: payload.signedBundle.bundleHash,
        signature: payload.signedBundle.signature,
        algorithm: payload.signedBundle.algorithm,
        keyId: payload.signedBundle.keyId,
        artifactCount: payload.signedBundle.artifactCount,
        approver: currentApproval?.resolvedBy,
      })
    } catch {
      // Signing is best-effort and should not block release actions.
    }
  }

  const runSelectedAction = async (action: PublishAction): Promise<void> => {
    recordMetric('export_initiated', { exportType: action })

    const publishResult = action === 'xcode'
      ? await runXcodeExport()
      : await runRemotePipeline(action)

    if (publishResult.backgroundRunId) {
      setActiveReleaseRunId(publishResult.backgroundRunId)
    }

    if (action === 'xcode' || publishResult.runStatus === 'succeeded') {
      markSuccessfulAction(action)
      await signAndRecordBundle(publishResult)
    }

    setResult(publishResult)
    setStatus('complete')
  }

  const handleStartAction = async (action: PublishAction) => {
    const availability = getActionAvailability(action)
    if (availability.disabled) {
      setSelectedAction(action)
      setStatus('error')
      setError(availability.reason || 'This action is currently unavailable.')
      return
    }

    setSelectedAction(action)
    setStatus('validating')
    setError(null)

    if (action === 'xcode') {
      setApprovalRequestId(null)
    } else {
      const requestId = requestApproval({
        action: ACTION_META[action].title,
        summary: `Approve ${ACTION_META[action].cta} for ${config.appName}`,
        requestedBy: 'torbit',
      })
      setApprovalRequestId(requestId)
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const validation = validateProject(projectFiles, config)
      setValidationResult(validation)
      setStatus('preflight')
    } catch (err) {
      logError('builder.publish.validation_failed', {
        message: err instanceof Error ? err.message : 'Validation failed',
      })
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Validation failed')
    }
  }

  const handleProceedAction = async () => {
    if (!validationResult?.canExport) return

    if (selectedAction !== 'xcode') {
      if (!currentApproval || currentApproval.status !== 'approved') {
        setStatus('error')
        setError('Approval is required before running this release action. Use the Trust Layer panel to approve and retry.')
        return
      }
    }

    setStatus('processing')
    setError(null)

    try {
      await runSelectedAction(selectedAction)
    } catch (err) {
      logError('builder.publish.run_failed', {
        action: selectedAction,
        message: err instanceof Error ? err.message : 'Pipeline failed',
      })
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Pipeline failed')
    }
  }

  const handleRunAgain = async () => {
    if (!result) return
    setStatus('processing')
    setError(null)

    try {
      await runSelectedAction(result.action)
    } catch (err) {
      logError('builder.publish.retry_failed', {
        action: result.action,
        message: err instanceof Error ? err.message : 'Retry failed',
      })
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Retry failed')
    }
  }

  const actionMeta = ACTION_META[selectedAction]

  const getActionAvailability = (action: PublishAction): { disabled: boolean; reason?: string } => {
    if (!hasFiles) {
      return { disabled: true, reason: 'Generate files before publishing.' }
    }

    if (action === 'xcode') {
      return { disabled: false }
    }

    if (diagnosticsLoading) {
      return { disabled: true, reason: 'Checking pipeline environment...' }
    }

    if (diagnostics && !diagnostics.expoTokenConfigured) {
      return { disabled: true, reason: 'EXPO_TOKEN is missing on server.' }
    }

    if (diagnostics && (action === 'testflight' || action === 'appstore-connect') && !diagnostics.iosSubmitAuthConfigured) {
      return { disabled: true, reason: 'Apple submit auth is missing on server.' }
    }

    if (diagnostics && action === 'android' && !diagnostics.googleServiceAccountConfigured) {
      return { disabled: true, reason: 'Google Play submit auth is missing on server.' }
    }

    if (diagnosticsError) {
      return { disabled: false, reason: 'Diagnostics unavailable; action will run with server-side checks.' }
    }

    return { disabled: false }
  }

  const getActionInlineWarning = (action: PublishAction): ActionInlineWarning | null => {
    if (action === 'xcode') {
      return null
    }

    if (diagnosticsLoading) {
      return null
    }

    if (diagnosticsError) {
      return {
        tone: 'warning',
        message: 'Diagnostics unavailable. Verify release credentials before running.',
      }
    }

    if (!diagnostics) {
      return null
    }

    if (!diagnostics.expoTokenConfigured) {
      return {
        tone: 'error',
        message: 'EXPO_TOKEN is missing on server. Remote release actions are blocked.',
      }
    }

    if ((action === 'testflight' || action === 'appstore-connect') && !diagnostics.iosSubmitAuthConfigured) {
      return {
        tone: 'error',
        message: 'Apple submit credentials not detected. This iOS action is blocked.',
      }
    }

    if (action === 'android' && !diagnostics.googleServiceAccountConfigured) {
      return {
        tone: 'error',
        message: 'Google service account not detected. Android action is blocked.',
      }
    }

    return null
  }

  const xcodeAvailability = getActionAvailability('xcode')
  const testflightAvailability = getActionAvailability('testflight')
  const appStoreAvailability = getActionAvailability('appstore-connect')
  const androidAvailability = getActionAvailability('android')
  const xcodeInlineWarning = getActionInlineWarning('xcode')
  const testflightInlineWarning = getActionInlineWarning('testflight')
  const appStoreInlineWarning = getActionInlineWarning('appstore-connect')
  const androidInlineWarning = getActionInlineWarning('android')
  const canDispatchQueuedRun = Boolean(
    activeReleaseRun
    && activeReleaseRun.status === 'queued'
    && !activeReleaseRun.cancel_requested
  )
  const canCancelReleaseRun = Boolean(
    activeReleaseRun
    && (activeReleaseRun.status === 'queued' || activeReleaseRun.status === 'running')
    && !activeReleaseRun.cancel_requested
  )
  const canRetryReleaseRun = Boolean(
    activeReleaseRun
    && activeReleaseRun.status === 'failed'
    && activeReleaseRun.retryable
    && activeReleaseRun.attempt_count < activeReleaseRun.max_attempts
  )
  const isDeferredCompletion = Boolean(
    result
    && result.action !== 'xcode'
    && result.runStatus
    && result.runStatus !== 'succeeded'
  )
  const isCompleteSuccess = Boolean(
    result
    && (result.action === 'xcode' || result.runStatus === 'succeeded' || result.runStatus === undefined)
  )
  const completeHeading = status === 'complete' && isDeferredCompletion
    ? (result?.runStatus === 'running' ? 'Release In Progress' : 'Release Queued')
    : status === 'preflight'
      ? 'Pre-flight Check'
      : status === 'complete'
        ? 'Pipeline Complete'
        : 'Publish Your App'
  const completeSubheading = status === 'complete' && isDeferredCompletion
    ? 'Track live progress in Release Rail.'
    : status === 'preflight'
      ? `Review before ${actionMeta.title.toLowerCase()}`
      : status === 'complete'
        ? 'Release action completed'
        : 'Run end-to-end mobile release actions'

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        disabled={!hasFiles}
        aria-label="Publish your mobile app. Export, TestFlight, App Store Connect, and Android pipeline."
        aria-disabled={!hasFiles}
        className="group flex items-center gap-2 px-3.5 py-1.5 text-[12px] font-medium tracking-wide rounded-lg border border-[#2a2a2a] hover:border-[#404040] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed
          bg-[#141414] text-[#e0e0e0] hover:bg-[#1f1f1f] hover:text-white
          active:scale-[0.98]"
      >
        <Rocket className="w-3.5 h-3.5 text-[#808080] group-hover:text-blue-400 transition-colors" aria-hidden="true" />
        Publish
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="publish-dialog-title"
        >
          <div
            ref={dialogRef}
            className="w-full max-w-lg mx-4 bg-[#0a0a0a] border border-[#1f1f1f] rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.7)] overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#111] border border-[#222] flex items-center justify-center" aria-hidden="true">
                  <Rocket className="w-4 h-4 text-[#808080]" />
                </div>
                <div>
                  <h2 id="publish-dialog-title" className="text-[#e8e8e8] text-[14px] font-semibold">
                    {completeHeading}
                  </h2>
                  <p className="text-[#505050] text-[12px]">
                    {completeSubheading}
                  </p>
                </div>
              </div>
              <button
                onClick={closePanel}
                aria-label="Close publish dialog"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-[#505050] hover:bg-[#1a1a1a] hover:text-[#a0a0a0] transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {activeReleaseRun && (
                <div className="p-3.5 bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[#d0d0d0] text-[13px] font-medium">Release Rail · {releaseRailTitle}</p>
                      <p className="text-[10px] text-[#505050] mt-0.5">{getReleaseRailSummary(activeReleaseRun)}</p>
                    </div>
                    <span className={`px-2 py-0.5 text-[9px] uppercase tracking-wider rounded border ${getReleaseRailStatusClass(activeReleaseRun.status)}`}>
                      {activeReleaseRun.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {releaseRailSteps.map((step) => (
                      <div
                        key={step.key}
                        className={`rounded-lg border px-2 py-1.5 text-center text-[10px] ${getReleaseRailStepClass(step.state)}`}
                      >
                        {step.label}
                      </div>
                    ))}
                  </div>

                  <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-200 ${getReleaseRailProgressClass(activeReleaseRun.status)}`}
                      style={{ width: `${Math.max(5, activeReleaseRun.progress)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-neutral-500">
                    <span>Attempt {activeReleaseRun.attempt_count}/{activeReleaseRun.max_attempts}</span>
                    {activeReleaseRun.next_retry_at ? (
                      <span>Retry at {formatRunTimestamp(activeReleaseRun.next_retry_at)}</span>
                    ) : null}
                  </div>

                  {activeReleaseRun.cancel_requested && activeReleaseRun.status === 'running' && (
                    <p className="text-[11px] text-amber-400">Cancel requested. Worker will stop at next checkpoint.</p>
                  )}

                  {releaseRailLinks.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-blue-400 font-medium">Latest Pipeline Links</p>
                      {releaseRailLinks.slice(0, 2).map((link) => (
                        <a
                          key={link}
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-[11px] text-blue-300 hover:text-blue-200 break-all"
                        >
                          {link}
                        </a>
                      ))}
                    </div>
                  )}

                  {(canDispatchQueuedRun || canCancelReleaseRun || canRetryReleaseRun) && (
                    <div className="flex items-center gap-2">
                      {canDispatchQueuedRun && (
                        <button
                          type="button"
                          disabled={releaseRailActionPending}
                          onClick={() => void handleReleaseRailDispatch()}
                          className="px-2.5 py-1 text-[11px] rounded border border-blue-500/30 text-blue-300 hover:bg-blue-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Dispatch Now
                        </button>
                      )}
                      {canRetryReleaseRun && (
                        <button
                          type="button"
                          disabled={releaseRailActionPending}
                          onClick={() => void handleReleaseRailRetry()}
                          className="px-2.5 py-1 text-[11px] rounded border border-blue-500/30 text-blue-300 hover:bg-blue-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Retry
                        </button>
                      )}
                      {canCancelReleaseRun && (
                        <button
                          type="button"
                          disabled={releaseRailActionPending}
                          onClick={() => void handleReleaseRailCancel()}
                          className="px-2.5 py-1 text-[11px] rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {status === 'idle' && (
                <>
                  <div className="p-3.5 bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[#b0b0b0] text-[12px] font-medium">Pipeline Environment</p>
                      <span className="text-[9px] text-[#404040] uppercase tracking-widest">Server</span>
                    </div>

                    {diagnosticsLoading ? (
                      <p className="text-[#505050] text-[11px]">Checking environment...</p>
                    ) : diagnosticsError ? (
                      <p className="text-amber-400 text-[11px]">{diagnosticsError}</p>
                    ) : diagnostics ? (
                      <div className="space-y-2 text-[11px]">
                        {[
                          { label: 'Expo Token', ok: diagnostics.expoTokenConfigured, required: true },
                          { label: 'iOS Submit Auth', ok: diagnostics.iosSubmitAuthConfigured, required: false },
                          { label: 'Android Submit Auth', ok: diagnostics.googleServiceAccountConfigured, required: false },
                        ].map(({ label, ok, required }) => (
                          <div key={label} className="flex items-center justify-between">
                            <span className="text-[#606060]">{label}{required ? ' *' : ''}</span>
                            <div className="flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : required ? 'bg-red-500' : 'bg-[#333]'}`} />
                              <span className={ok ? 'text-emerald-400/80' : required ? 'text-red-400/80' : 'text-[#505050]'}>
                                {ok ? 'Ready' : required ? 'Missing' : 'Not set'}
                              </span>
                            </div>
                          </div>
                        ))}

                        {diagnostics.warnings.length > 0 && (
                          <p className="text-amber-400/60 text-[10px] leading-relaxed pt-1.5 border-t border-[#1a1a1a]">
                            {diagnostics.warnings[0]}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[#505050] text-[11px]">Diagnostics unavailable.</p>
                    )}
                  </div>

                  {/* Action cards */}
                  <div className="space-y-2">
                    {([
                      { action: 'xcode' as PublishAction, availability: xcodeAvailability, warning: xcodeInlineWarning, icon: Apple, accent: 'blue' },
                      { action: 'testflight' as PublishAction, availability: testflightAvailability, warning: testflightInlineWarning, icon: TestTube, accent: 'emerald' },
                      { action: 'appstore-connect' as PublishAction, availability: appStoreAvailability, warning: appStoreInlineWarning, icon: Store, accent: 'fuchsia' },
                      { action: 'android' as PublishAction, availability: androidAvailability, warning: androidInlineWarning, icon: Smartphone, accent: 'orange' },
                    ] as const).map(({ action, availability, warning, icon: Icon, accent }) => {
                      const meta = ACTION_META[action]
                      const accentMap = {
                        blue: { icon: 'from-blue-500/20 to-blue-600/10 border-blue-500/20 group-hover:border-blue-500/40', badge: 'bg-blue-500/10 text-blue-400', iconColor: 'text-blue-400' },
                        emerald: { icon: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/20 group-hover:border-emerald-500/40', badge: 'bg-emerald-500/10 text-emerald-400', iconColor: 'text-emerald-400' },
                        fuchsia: { icon: 'from-fuchsia-500/20 to-fuchsia-600/10 border-fuchsia-500/20 group-hover:border-fuchsia-500/40', badge: 'bg-fuchsia-500/10 text-fuchsia-400', iconColor: 'text-fuchsia-400' },
                        orange: { icon: 'from-orange-500/20 to-orange-600/10 border-orange-500/20 group-hover:border-orange-500/40', badge: 'bg-orange-500/10 text-orange-400', iconColor: 'text-orange-400' },
                      } as const
                      const colors = accentMap[accent]

                      return (
                        <button
                          key={action}
                          onClick={() => void handleStartAction(action)}
                          disabled={availability.disabled}
                          title={availability.reason}
                          className="w-full flex items-center gap-3.5 p-3.5 bg-[#0f0f0f] hover:bg-[#151515] border border-[#1a1a1a] hover:border-[#2a2a2a] rounded-xl transition-all text-left disabled:opacity-40 disabled:cursor-not-allowed group"
                        >
                          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${colors.icon} border flex items-center justify-center flex-shrink-0 transition-colors`}>
                            <Icon className={`w-5 h-5 ${colors.iconColor}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-[#d0d0d0] group-hover:text-white transition-colors">{meta.title}</span>
                              <span className={`px-1.5 py-0.5 text-[10px] rounded ${colors.badge}`}>{meta.badge}</span>
                            </div>
                            <p className="text-[11px] text-[#505050] mt-0.5">{meta.description}</p>
                            {warning && (
                              <p className={`mt-1 text-[10px] flex items-center gap-1 ${
                                warning.tone === 'error' ? 'text-red-400' : 'text-amber-400'
                              }`}>
                                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{warning.message}</span>
                              </p>
                            )}
                          </div>
                          <ChevronRight className="w-4 h-4 text-[#333] group-hover:text-[#666] transition-colors flex-shrink-0" />
                        </button>
                      )
                    })}
                  </div>

                  <div className="p-3.5 bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl space-y-2.5">
                    <p className="text-[#b0b0b0] text-[12px] font-medium">Android Track</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {ANDROID_TRACK_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setAndroidTrack(option.value)}
                          type="button"
                          className={`rounded-lg border px-3 py-2 text-left transition-all ${
                            androidTrack === option.value
                              ? 'border-orange-500/30 bg-orange-500/5'
                              : 'border-[#1a1a1a] bg-[#080808] hover:border-[#2a2a2a]'
                          }`}
                        >
                          <p className={`text-[11px] font-medium ${androidTrack === option.value ? 'text-orange-300' : 'text-[#808080]'}`}>
                            {option.label}
                          </p>
                          <p className="text-[10px] text-[#404040] mt-0.5">{option.hint}</p>
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-[#404040]">
                      Submit profile: <code className="text-[#707070] font-mono">android-{androidTrack}</code>
                    </p>
                  </div>

                  <div className="pt-3 border-t border-[#1a1a1a]">
                    <p className="text-[10px] text-[#4a4a4a] uppercase tracking-widest px-1 mb-2">Export Mode</p>

                    <div className="flex items-center gap-3 p-3 bg-[#0f0f0f] border border-[#1a1a1a] rounded-lg mb-1.5">
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-blue-500 flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      </div>
                      <div className="flex-1">
                        <span className="text-[#c0c0c0] text-[12px] font-medium">Expo</span>
                        <span className="text-[#505050] text-[10px] ml-2">Recommended</span>
                      </div>
                    </div>

                    <button
                      disabled
                      onClick={() => recordMetric('feature_interest_capacitor')}
                      className="w-full flex items-center gap-3 p-3 bg-[#080808] border border-[#151515] rounded-lg opacity-40 cursor-not-allowed"
                      title="Native shell export with audited permissions. Available after launch."
                    >
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-[#333]" />
                      <div className="flex-1 text-left">
                        <span className="text-[#505050] text-[12px] font-medium">Capacitor</span>
                        <span className="text-[#404040] text-[10px] ml-2">Native shell</span>
                      </div>
                      <span className="text-[9px] text-[#404040] uppercase tracking-widest">Soon</span>
                    </button>
                  </div>
                </>
              )}

              {status === 'validating' && (
                <div className="py-12 flex flex-col items-center gap-4">
                  <TorbitSpinner size="xl" />
                  <div className="text-center">
                    <p className="text-white font-medium">Validating Project</p>
                    <p className="text-neutral-500 text-sm mt-1">Checking configuration and release readiness...</p>
                  </div>
                </div>
              )}

              {status === 'preflight' && validationResult && (
                <div className="space-y-3">
                  <TrustLayerCard
                    action={actionMeta.title}
                    summary={`Approve ${actionMeta.cta} for ${config.appName}`}
                    requestId={approvalRequestId}
                    requireApproval={selectedAction !== 'xcode'}
                    onRequestIdChange={setApprovalRequestId}
                  />
                  <PreflightChecklist
                    result={validationResult}
                    onProceed={handleProceedAction}
                    onCancel={closePanel}
                    isExporting={false}
                    actionLabel={selectedAction === 'android' ? `${actionMeta.cta} (${androidTrack})` : actionMeta.cta}
                    readyLabel={
                      selectedAction === 'android'
                        ? `Your project is configured correctly for Android ${androidTrack} release.`
                        : `Your project is configured correctly for ${actionMeta.title}.`
                    }
                  />
                </div>
              )}

              {status === 'processing' && (
                <div className="py-12 flex flex-col items-center gap-4">
                  <TorbitSpinner size="xl" />
                  <div className="text-center">
                    <p className="text-white font-medium">{actionMeta.cta}</p>
                    <p className="text-neutral-500 text-sm mt-1">
                      {selectedAction === 'xcode'
                        ? 'Generating export bundle...'
                        : selectedAction === 'android'
                          ? `Running remote release pipeline (${androidTrack} track)...`
                          : 'Running remote release pipeline...'}
                    </p>
                  </div>
                </div>
              )}

              {status === 'complete' && result && (
                <div className="space-y-4">
                  {isCompleteSuccess && (
                    <GovernanceResolved
                      supervisorReviewed={true}
                      qualityPassed={true}
                    />
                  )}

                  <TrustLayerCard
                    action={ACTION_META[result.action].title}
                    summary={
                      isDeferredCompletion
                        ? `Release action is in progress for ${result.appName}`
                        : `Release action completed for ${result.appName}`
                    }
                    requestId={approvalRequestId}
                    requireApproval={false}
                  />

                  <div className={`flex items-center gap-3 p-4 rounded-xl border ${
                    isCompleteSuccess
                      ? 'bg-emerald-500/10 border-emerald-500/20'
                      : 'bg-blue-500/10 border-blue-500/20'
                  }`}>
                    <CheckCircle2 className={`w-6 h-6 ${isCompleteSuccess ? 'text-emerald-500' : 'text-blue-400'}`} />
                    <div>
                      <p className={`font-medium ${isCompleteSuccess ? 'text-emerald-400' : 'text-blue-300'}`}>
                        {result.message}
                      </p>
                      <p className={`text-sm mt-0.5 ${isCompleteSuccess ? 'text-emerald-500/60' : 'text-blue-300/70'}`}>
                        {isDeferredCompletion
                          ? 'Background run is active. Release Rail shows live progress and retry state.'
                          : result.links.length > 0
                            ? 'Opened first pipeline link in a new tab'
                            : 'Action completed successfully'}
                      </p>
                    </div>
                  </div>

                  <div className="p-4 bg-neutral-900 border border-neutral-800 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-neutral-400 text-sm">
                        <Smartphone className="w-4 h-4" />
                        App Name
                      </div>
                      <span className="text-white font-medium">{result.appName}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-neutral-400 text-sm">
                        <Package className="w-4 h-4" />
                        Version
                      </div>
                      <span className="text-white font-medium">{result.version}</span>
                    </div>

                    {result.action === 'android' && result.androidTrack && (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-neutral-400 text-sm">
                          <Store className="w-4 h-4" />
                          Android Track
                        </div>
                        <span className="text-white font-medium capitalize">{result.androidTrack}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-neutral-400 text-sm">
                        <FileCode className="w-4 h-4" />
                        Files
                      </div>
                      <span className="text-white font-medium">{result.fileCount} files</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-neutral-400 text-sm">
                        <Shield className="w-4 h-4" />
                        Capabilities
                      </div>
                      <div className="flex gap-1">
                        {result.capabilities.length > 0 ? (
                          result.capabilities.slice(0, 3).map((capability) => (
                            <span key={capability} className="px-2 py-0.5 bg-neutral-800 text-neutral-300 text-xs rounded">
                              {capability}
                            </span>
                          ))
                        ) : (
                          <span className="text-neutral-500 text-sm">None</span>
                        )}
                        {result.capabilities.length > 3 && (
                          <span className="px-2 py-0.5 bg-neutral-800 text-neutral-400 text-xs rounded">
                            +{result.capabilities.length - 3}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-neutral-400 text-sm">
                        <Clock className="w-4 h-4" />
                        {isDeferredCompletion ? 'Updated At' : 'Completed At'}
                      </div>
                      <span className="text-neutral-300 text-sm">{result.completedAt}</span>
                    </div>

                    <div className="pt-2 mt-2 border-t border-neutral-800">
                      <span className="text-[10px] text-neutral-600">
                        {isCompleteSuccess
                          ? 'Includes audit ledger and verification proof'
                          : 'Audit bundle signs after successful completion.'}
                      </span>
                    </div>
                  </div>

                  {result.links.length > 0 && (
                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl space-y-1">
                      <p className="text-blue-400 text-sm font-medium">Pipeline Links</p>
                      {result.links.slice(0, 3).map((link) => (
                        <a
                          key={link}
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-blue-300 hover:text-blue-200 text-xs break-all"
                        >
                          {link}
                        </a>
                      ))}
                    </div>
                  )}

                  {isCompleteSuccess && validationResult && validationResult.stats.warnings > 0 && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                      <div className="flex items-center gap-2 text-amber-400 text-sm">
                        <AlertTriangle className="w-4 h-4" />
                        <span>
                          Completed with {validationResult.stats.warnings} warning{validationResult.stats.warnings !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <p className="text-amber-500/60 text-xs mt-1">
                        Review submission checklists before release promotion.
                      </p>
                    </div>
                  )}

                  <div className="p-4 bg-neutral-900/50 border border-neutral-800 rounded-xl">
                    <p className="text-neutral-400 text-sm font-medium mb-2">Next Steps</p>
                    <ol className="text-neutral-500 text-sm space-y-1.5">
                      {(isDeferredCompletion
                        ? [
                          'Monitor Release Rail for queued, running, retry, or completion changes.',
                          'Open pipeline links as they appear and validate the submitted build.',
                          'Use Retry or Cancel controls if governance or pipeline checks fail.',
                        ]
                        : getActionNextSteps(result.action, result.androidTrack)
                      ).map((step, index) => (
                        <li key={step} className="flex items-start gap-2">
                          <span className="text-[#c0c0c0] font-mono">{index + 1}.</span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="flex gap-2.5">
                    <button
                      onClick={closePanel}
                      className="flex-1 py-2.5 bg-[#141414] hover:bg-[#1f1f1f] border border-[#2a2a2a] text-[#c0c0c0] text-[13px] font-medium rounded-xl transition-colors"
                    >
                      Done
                    </button>
                    <button
                      onClick={() => void handleRunAgain()}
                      className="flex items-center justify-center gap-2 px-5 py-2.5 bg-[#1a1a1a] hover:bg-[#222] border border-[#333] text-white text-[13px] font-medium rounded-xl transition-colors"
                    >
                      {result.action === 'xcode' ? <Download className="w-3.5 h-3.5" /> : <Rocket className="w-3.5 h-3.5" />}
                      {result.action === 'xcode' ? 'Download Again' : 'Run Again'}
                    </button>
                  </div>
                </div>
              )}

              {status === 'error' && (
                <div className="py-8 flex flex-col items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-red-500/5 border border-red-500/10 flex items-center justify-center">
                    <X className="w-6 h-6 text-red-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-[#e0e0e0] text-[14px] font-medium">{buildFailureTitle(selectedAction)}</p>
                    <p className="text-[#606060] text-[12px] mt-1 max-w-sm">{error || 'An unexpected error occurred'}</p>
                  </div>
                  <button
                    onClick={resetPanel}
                    className="px-5 py-2 bg-[#141414] hover:bg-[#1f1f1f] border border-[#2a2a2a] text-[#c0c0c0] text-[12px] font-medium rounded-lg transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
