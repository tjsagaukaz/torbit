'use client'

import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from 'react'
import { useTerminalStore, type LogType } from '@/store/terminal'
import { useBuilderStore } from '@/store/builder'
import { NervousSystem } from '@/lib/nervous-system'
import { getSupabase } from '@/lib/supabase/client'
import {
  classifyBuildFailure,
  isSandboxOwnershipFailure,
  type BuildFailure,
  type BuildFailureStage,
} from '@/lib/runtime/build-diagnostics'

// ============================================================================
// E2B Sandbox Context (Client-Side)
// ============================================================================
// Provides a shared E2B cloud sandbox instance across the entire app.
// Communicates with /api/e2b route for actual sandbox operations.
//
// E2B Benefits:
// - Real Linux environment (not an emulation)
// - Persistent sessions up to 24 hours
// - No browser security restrictions (SharedArrayBuffer, etc.)
// - Faster npm installs via caching
// - Works with Next.js, Vite, and SvelteKit templates.
//
// ⚠️ INVARIANT: Runtime command and health port must match generated stack.
// ============================================================================

// Verification metadata for audit trail
export interface VerificationMetadata {
  environmentVerifiedAt: number | null
  runtimeVersion: string | null
  sandboxId: string | null
  dependenciesLockedAt: number | null
  dependencyCount: number
  lockfileHash: string | null
}

interface E2BContextValue {
  // State
  sandboxId: string | null
  isBooting: boolean
  isReady: boolean
  serverUrl: string | null
  error: string | null
  buildFailure: BuildFailure | null
  
  // Verification metadata
  verification: VerificationMetadata
  
  // Operations
  writeFile: (path: string, content: string) => Promise<void>
  readFile: (path: string) => Promise<string | null>
  runCommand: (cmd: string, args?: string[], timeoutMs?: number) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  syncFilesToSandbox: () => Promise<void>
  killSandbox: () => Promise<void>
  requestPreviewRebuild: (reason?: string) => void
}

const E2BContext = createContext<E2BContextValue | null>(null)

// Module-level flag to prevent duplicate boot logs in Strict Mode
let hasLoggedBoot = false
const RUNTIME_STARTUP_TIMEOUT_MS = 45000
const HOST_PROBE_REQUEST_TIMEOUT_MS = 6000
const HOST_PROBE_MAX_RETRIES = 1
const ROUTE_PROBE_FETCH_TIMEOUT_MS = 8000
const ROUTE_PROBE_COMMAND_TIMEOUT_MS = 20000
const ROUTE_PROBE_MAX_ATTEMPTS = 3
const ROUTE_PROBE_RETRY_DELAY_MS = 1000
const PREVIEW_BUILD_IDLE_GRACE_MS = 2200
const DEFAULT_E2B_ACTION_TIMEOUT_MS = 30000
const E2B_ACTION_TIMEOUT_MS: Record<string, number> = {
  create: 45000,
  makeDir: 20000,
  writeFile: 25000,
  readFile: 20000,
  getHost: 12000,
  kill: 15000,
}
const E2B_RETRY_BUDGET: Record<string, number> = {
  makeDir: 5,
  writeFile: 5,
  readFile: 3,
  getHost: 1,
}

interface RuntimeProfile {
  framework: 'nextjs' | 'vite'
  command: string
  port: number
}

const INSTALL_COMMAND_PRIMARY = 'npm install'
const INSTALL_COMMAND_LEGACY = 'npm install --legacy-peer-deps'
const INSTALL_COMMAND_FORCE = 'npm install --force'
const PREVIEW_BRIDGE_MARKER = 'TORBIT_PREVIEW_BRIDGE'
const PREVIEW_BRIDGE_INLINE_SCRIPT = "window.addEventListener('message',function(event){const data=event&&event.data;if(!data||data.type!=='TORBIT_INJECT_SPY'||typeof data.script!=='string'){return;}try{(0,eval)(data.script);}catch(error){console.error('TORBIT_SPY_INJECT_FAILED',error);}});"

class E2BApiError extends Error {
  code?: string
  status: number

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'E2BApiError'
    this.status = status
    this.code = code
  }
}

// Simple hash generator for verification (deterministic)
function generateHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(16, '0')
}

export function normalizeRuntimePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '')
}

export function createFilesFingerprint(files: Array<{ path: string; content: string }>): string {
  if (files.length === 0) {
    return ''
  }

  const entries = files
    .map((file) => `${normalizeRuntimePath(file.path)}:${generateHash(file.content)}`)
    .sort()

  return generateHash(entries.join('|'))
}

const DEPENDENCY_MANIFEST_FILE_PATTERN = /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i

export function isDependencyManifestPath(path: string): boolean {
  return DEPENDENCY_MANIFEST_FILE_PATTERN.test(normalizeRuntimePath(path))
}

export function createDependencyFingerprint(files: Array<{ path: string; content: string }>): string {
  const entries = files
    .filter((file) => isDependencyManifestPath(file.path))
    .map((file) => `${normalizeRuntimePath(file.path)}:${generateHash(file.content)}`)
    .sort()

  if (entries.length === 0) {
    return ''
  }

  return generateHash(entries.join('|'))
}

export function shouldDelayPreviewBuildWhileGenerating(
  isGenerating: boolean,
  lastFileMutationAt: number,
  now: number = Date.now(),
  idleGraceMs: number = PREVIEW_BUILD_IDLE_GRACE_MS
): boolean {
  if (!isGenerating) return false
  if (!Number.isFinite(lastFileMutationAt) || lastFileMutationAt <= 0) return true
  return (now - lastFileMutationAt) < idleGraceMs
}

export function resolveRuntimeProfile(files: Array<{ path: string; content: string }>): RuntimeProfile {
  const packageFile = files.find((file) => file.path === 'package.json' || file.path === '/package.json')
  if (!packageFile) {
    return {
      framework: 'nextjs',
      command: 'npm run dev -- --hostname 0.0.0.0 --port 3000',
      port: 3000,
    }
  }

  try {
    const pkg = JSON.parse(packageFile.content) as {
      scripts?: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    }

    const devScript = (pkg.scripts?.dev || '').toLowerCase()
    const hasNext = Boolean(deps.next) || devScript.includes('next')
    const hasVite = Boolean(deps.vite) || devScript.includes('vite')

    if (!hasNext && hasVite) {
      return {
        framework: 'vite',
        command: 'npm run dev -- --host 0.0.0.0 --port 5173',
        port: 5173,
      }
    }

    return {
      framework: 'nextjs',
      command: 'npm run dev -- --hostname 0.0.0.0 --port 3000',
      port: 3000,
    }
  } catch {
    return {
      framework: 'nextjs',
      command: 'npm run dev -- --hostname 0.0.0.0 --port 3000',
      port: 3000,
    }
  }
}

export function isDependencyResolutionFailure(output: string): boolean {
  const normalized = output.toLowerCase()
  return normalized.includes('eresolve') ||
    normalized.includes('unable to resolve dependency tree') ||
    normalized.includes('conflicting peer dependency') ||
    normalized.includes('peer dependency')
}

export function nextInstallRecoveryCommand(previousCommand: string, output: string): string | null {
  if (!isDependencyResolutionFailure(output)) {
    return null
  }

  if (previousCommand === INSTALL_COMMAND_PRIMARY) {
    return INSTALL_COMMAND_LEGACY
  }

  if (previousCommand === INSTALL_COMMAND_LEGACY) {
    return INSTALL_COMMAND_FORCE
  }

  return null
}

function isRetryableRouteProbeFailure(details: string): boolean {
  const normalized = details.toLowerCase()
  return (
    normalized.includes('operation was aborted') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout') ||
    normalized.includes('fetch failed') ||
    normalized.includes('econnrefused') ||
    normalized.includes('socket hang up') ||
    normalized.includes('empty-runtime-html')
  )
}

export function shouldAllowSoftRuntimeValidationFailure(details: string): boolean {
  const normalized = details.toLowerCase()
  if (
    normalized.includes('module not found') ||
    normalized.includes('cannot find module') ||
    normalized.includes('syntaxerror') ||
    normalized.includes('typeerror') ||
    normalized.includes('referenceerror')
  ) {
    return false
  }

  return isRetryableRouteProbeFailure(details)
}

function sanitizeRuntimeValidationDetails(details: string): string {
  return details
    .replace(/route_probe_fail/gi, 'runtime_validation_fail')
    .replace(/route_probe_ok/gi, 'runtime_validation_ok')
    .replace(/route[_\s-]?probe/gi, 'runtime validation')
}

export function createRuntimeProbeCommand(
  port: number,
  options?: { fetchTimeoutMs?: number }
): string {
  const normalizedPort = Number.isFinite(port) && port > 0 ? Math.floor(port) : 3000
  const fetchTimeoutMs = (
    typeof options?.fetchTimeoutMs === 'number' &&
    Number.isFinite(options.fetchTimeoutMs) &&
    options.fetchTimeoutMs > 0
  ) ? Math.floor(options.fetchTimeoutMs) : ROUTE_PROBE_FETCH_TIMEOUT_MS
  const script = `
const target = 'http://127.0.0.1:${normalizedPort}';
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), ${fetchTimeoutMs});

(async () => {
  try {
    const response = await fetch(target, { signal: controller.signal, redirect: 'manual' });
    const html = await response.text();
    const normalizedHtml = html.replace(/\\s+/g, ' ').trim();
    const bodyMatch = normalizedHtml.match(/<body[^>]*>([\\s\\S]*?)<\\/body>/i);
    const bodyHtml = (bodyMatch ? bodyMatch[1] : normalizedHtml).trim();
    const bodyWithoutScripts = bodyHtml
      .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')
      .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
      .replace(/<noscript[\\s\\S]*?<\\/noscript>/gi, ' ')
      .trim();
    const textOnly = bodyWithoutScripts
      .replace(/<[^>]+>/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
    const hasRenderableMarkup = /<(main|section|article|header|footer|nav|aside|h1|h2|h3|p|button|input|form|canvas|svg|img|ul|ol|table|div)[\\s>]/i.test(bodyWithoutScripts);

    if (response.status >= 500) {
      console.error('RUNTIME_VALIDATION_FAIL status=' + response.status);
      process.exit(1);
      return;
    }

    if (!hasRenderableMarkup && textOnly.length === 0) {
      console.error('RUNTIME_VALIDATION_FAIL empty-runtime-html status=' + response.status);
      process.exit(1);
      return;
    }

    console.log('RUNTIME_VALIDATION_OK status=' + response.status + ' text=' + textOnly.slice(0, 120));
    process.exit(0);
  } catch (error) {
    console.error('RUNTIME_VALIDATION_FAIL ' + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  } finally {
    clearTimeout(timeout);
  }
})();
`.trim()

  // `node -e` receives one argv string; literal "\n" tokens break parsing in some shells.
  // Compact to a single line so the eval payload is shell-safe.
  const compactScript = script
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')

  return `node -e ${JSON.stringify(compactScript)}`
}

export function injectPreviewBridgeIntoNextLayout(layoutContent: string): string {
  if (!layoutContent || layoutContent.includes(PREVIEW_BRIDGE_MARKER)) {
    return layoutContent
  }

  if (!layoutContent.includes('</body>')) {
    return layoutContent
  }

  const bridgeScript = `
      {/* ${PREVIEW_BRIDGE_MARKER}: enables iframe-to-preview console diagnostics */}
      <script
        dangerouslySetInnerHTML={{
          __html: ${JSON.stringify(PREVIEW_BRIDGE_INLINE_SCRIPT)},
        }}
      />`

  return layoutContent.replace('</body>', `${bridgeScript}
      </body>`)
}

export function useE2BContext() {
  const context = useContext(E2BContext)
  if (!context) {
    throw new Error('useE2BContext must be used within E2BProvider')
  }
  return context
}

interface E2BErrorPayload {
  error?: string
  message?: string
  code?: string
  retryAfter?: number
}

interface E2BApiRequestOptions {
  maxRetries?: number
  requestTimeoutMs?: number
}

function shouldRetryE2BRequest(action: string, status: number, message: string): boolean {
  if (!(action in E2B_RETRY_BUDGET)) {
    return false
  }

  if (status === 408) {
    return true
  }

  if (status === 429) {
    return true
  }

  if (status === 502 || status === 503 || status === 504) {
    return true
  }

  const normalized = message.toLowerCase()
  return (
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout') ||
    normalized.includes('aborted') ||
    normalized.includes('fetch failed') ||
    normalized.includes('network')
  )
}

function resolveRetryDelayMs(
  attempt: number,
  retryAfterSecondsFromPayload: number | null,
  retryAfterHeader: string | null
): number {
  const retryAfterHeaderSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN
  const retryAfterSeconds = Number.isFinite(retryAfterHeaderSeconds) && retryAfterHeaderSeconds > 0
    ? retryAfterHeaderSeconds
    : retryAfterSecondsFromPayload

  const baseDelayMs = retryAfterSeconds && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : Math.min(4000, 250 * (2 ** attempt))

  const jitterMs = Math.floor(Math.random() * 150)
  return baseDelayMs + jitterMs
}

// API helper for E2B operations
async function e2bApi(
  action: string,
  params: Record<string, unknown> = {},
  options: E2BApiRequestOptions = {}
) {
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  const supabase = getSupabase()
  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`
    }
  }

  const configuredMaxRetries = (
    typeof options.maxRetries === 'number' &&
    Number.isFinite(options.maxRetries) &&
    options.maxRetries >= 0
  ) ? Math.floor(options.maxRetries) : (E2B_RETRY_BUDGET[action] ?? 0)

  for (let attempt = 0; attempt <= configuredMaxRetries; attempt++) {
    const requestedTimeoutMs = (
      action === 'runCommand' &&
      typeof params.timeoutMs === 'number' &&
      Number.isFinite(params.timeoutMs) &&
      params.timeoutMs > 0
    ) ? Math.floor(params.timeoutMs) : null

    const overrideTimeoutMs = (
      typeof options.requestTimeoutMs === 'number' &&
      Number.isFinite(options.requestTimeoutMs) &&
      options.requestTimeoutMs > 0
    ) ? Math.floor(options.requestTimeoutMs) : null

    const requestTimeoutMs = overrideTimeoutMs ?? (
      requestedTimeoutMs
        ? Math.min(Math.max(requestedTimeoutMs + 15000, 45000), 6 * 60 * 1000)
        : (E2B_ACTION_TIMEOUT_MS[action] || DEFAULT_E2B_ACTION_TIMEOUT_MS)
    )

    let response: Response

    try {
      const controller = new AbortController()
      const timeoutHandle = setTimeout(() => controller.abort(), requestTimeoutMs)

      try {
        response = await fetch('/api/e2b', {
          method: 'POST',
          headers,
          body: JSON.stringify({ action, ...params }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutHandle)
      }
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      const message = isTimeout
        ? `E2B ${action} request timed out after ${requestTimeoutMs}ms`
        : (err instanceof Error ? err.message : 'E2B network request failed')
      const status = isTimeout ? 504 : 500
      const canRetry = attempt < configuredMaxRetries && shouldRetryE2BRequest(action, status, message)

      if (canRetry) {
        const delayMs = Math.min(4000, 250 * (2 ** attempt)) + Math.floor(Math.random() * 150)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        continue
      }

      throw new E2BApiError(
        message,
        status,
        isTimeout ? 'E2B_REQUEST_TIMEOUT' : 'E2B_NETWORK_ERROR'
      )
    }

    if (response.ok) {
      return response.json()
    }

    let message = 'E2B API error'
    let code: string | undefined
    let retryAfterFromPayload: number | null = null

    try {
      const error = await response.json() as E2BErrorPayload
      message = error.error || error.message || message
      code = error.code
      if (typeof error.retryAfter === 'number' && Number.isFinite(error.retryAfter)) {
        retryAfterFromPayload = error.retryAfter
      }
    } catch {
      // Response body may be empty/non-JSON.
    }

    const canRetry = attempt < configuredMaxRetries && shouldRetryE2BRequest(action, response.status, message)
    if (!canRetry) {
      throw new E2BApiError(message, response.status, code)
    }

    const delayMs = resolveRetryDelayMs(
      attempt,
      retryAfterFromPayload,
      response.headers.get('Retry-After')
    )

    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  throw new E2BApiError('E2B API retries exhausted', 500)
}

interface E2BProviderProps {
  children: ReactNode
}

function E2BMockProvider({ children }: E2BProviderProps) {
  const mockFiles = useRef<Record<string, string>>({})
  const mockValue: E2BContextValue = {
    sandboxId: 'mock-sandbox',
    isBooting: false,
    isReady: true,
    serverUrl: null,
    error: null,
    buildFailure: null,
    verification: {
      environmentVerifiedAt: null,
      runtimeVersion: 'mock',
      sandboxId: 'mock-sandbox',
      dependenciesLockedAt: null,
      dependencyCount: 0,
      lockfileHash: null,
    },
    writeFile: async (path, content) => { mockFiles.current[path] = content },
    readFile: async (path) => mockFiles.current[path] ?? null,
    runCommand: async () => ({ exitCode: 0, stdout: '[mock] command skipped', stderr: '' }),
    syncFilesToSandbox: async () => {},
    killSandbox: async () => {},
    requestPreviewRebuild: () => {},
  }

  return <E2BContext.Provider value={mockValue}>{children}</E2BContext.Provider>
}

function E2BRealProvider({ children }: E2BProviderProps) {

  const [sandboxId, setSandboxId] = useState<string | null>(null)
  const [sandboxAccessToken, setSandboxAccessToken] = useState<string | null>(null)
  const [isBooting, setIsBooting] = useState(true)
  const [isReady, setIsReady] = useState(false)
  const [serverUrl, setServerUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [buildFailure, setBuildFailure] = useState<BuildFailure | null>(null)
  
  const [verification, setVerification] = useState<VerificationMetadata>({
    environmentVerifiedAt: null,
    runtimeVersion: null,
    sandboxId: null,
    dependenciesLockedAt: null,
    dependencyCount: 0,
    lockfileHash: null,
  })
  
  const { addLog, addCommand, setRunning, setExitCode } = useTerminalStore()
  const { files, isGenerating } = useBuilderStore()
  const filesFingerprint = createFilesFingerprint(files)
  const dependencyFingerprint = createDependencyFingerprint(files)
  
  // Track build state across renders
  const fullBuildInFlightRef = useRef(false)
  const liveSyncInFlightRef = useRef(false)
  const lastBuildAttemptHashRef = useRef<string>('')
  const lastSyncedHashRef = useRef<string>('')
  const lastFileMutationAtRef = useRef<number>(Date.now())
  const lastInstalledDependenciesFingerprintRef = useRef<string>('')
  const wasGeneratingRef = useRef(false)
  const autoRecoveryAttemptedRef = useRef(false)
  const queuedManualRetryRef = useRef(false)
  const lastFailureSignatureRef = useRef<string>('')
  const repeatedFailureCountRef = useRef<number>(0)
  const [manualBuildNonce, setManualBuildNonce] = useState(0)
  const [generationQuietToken, setGenerationQuietToken] = useState(0)
  
  // Track last file mutation time so preview can bootstrap once generation
  // goes quiet (without waiting for stream completion).
  useEffect(() => {
    lastFileMutationAtRef.current = Date.now()
  }, [filesFingerprint])

  useEffect(() => {
    if (!isGenerating) return

    const elapsedMs = Date.now() - lastFileMutationAtRef.current
    const remainingMs = PREVIEW_BUILD_IDLE_GRACE_MS - elapsedMs
    if (remainingMs <= 0) {
      setGenerationQuietToken((value) => value + 1)
      return
    }

    const timeout = setTimeout(() => {
      setGenerationQuietToken((value) => value + 1)
    }, remainingMs + 50)

    return () => clearTimeout(timeout)
  }, [isGenerating, filesFingerprint])

  const resetFailureLogDedup = useCallback(() => {
    lastFailureSignatureRef.current = ''
    repeatedFailureCountRef.current = 0
  }, [])

  const applyBuildFailureState = useCallback((failure: BuildFailure) => {
    const signature = `${failure.stage}|${failure.command || 'n/a'}|${failure.exactLogLine}`
    if (signature !== lastFailureSignatureRef.current) {
      lastFailureSignatureRef.current = signature
      repeatedFailureCountRef.current = 1
      addLog(`❌ ${failure.exactLogLine}`, 'error')
    } else {
      repeatedFailureCountRef.current += 1
      if (repeatedFailureCountRef.current === 2 || repeatedFailureCountRef.current % 3 === 0) {
        addLog(`⚠️ Repeated preview failure (${repeatedFailureCountRef.current}x): ${failure.exactLogLine}`, 'warning')
      }
    }

    setBuildFailure(failure)
    setError(failure.message)
    setServerUrl(null)
  }, [addLog])

  const requestPreviewRebuild = useCallback((reason: string = 'manual retry') => {
    addLog(`🔁 Retrying preview boot (${reason})...`, 'info')
    setError(null)
    setBuildFailure(null)
    setServerUrl(null)
    autoRecoveryAttemptedRef.current = false
    lastBuildAttemptHashRef.current = ''
    lastSyncedHashRef.current = ''
    resetFailureLogDedup()

    if (fullBuildInFlightRef.current) {
      queuedManualRetryRef.current = true
      return
    }

    setManualBuildNonce((value) => value + 1)
  }, [addLog, resetFailureLogDedup])

  // Reset build error state when a fresh generation starts.
  useEffect(() => {
    if (isGenerating && !wasGeneratingRef.current) {
      fullBuildInFlightRef.current = false
      liveSyncInFlightRef.current = false
      autoRecoveryAttemptedRef.current = false
      lastBuildAttemptHashRef.current = ''
      lastSyncedHashRef.current = ''
      setError(null)
      setBuildFailure(null)
      resetFailureLogDedup()
    }
    wasGeneratingRef.current = isGenerating
  }, [isGenerating, resetFailureLogDedup])
  
  // ==========================================================================
  // Boot E2B Sandbox
  // ==========================================================================
  useEffect(() => {
    let mounted = true
    
    async function bootSandbox() {
      // Prevent duplicate logging in Strict Mode
      if (!hasLoggedBoot) {
        addLog('🚀 Booting E2B cloud sandbox...', 'info')
        hasLoggedBoot = true
      }
      
      try {
        const result = await e2bApi('create')
        
        if (!mounted) return
        
        setSandboxId(result.sandboxId)
        setSandboxAccessToken(typeof result.sandboxAccessToken === 'string' ? result.sandboxAccessToken : null)
        setVerification(prev => ({
          ...prev,
          sandboxId: result.sandboxId,
          environmentVerifiedAt: Date.now(),
          runtimeVersion: 'E2B Linux',
        }))
        
        addLog(`✅ E2B sandbox ready: ${result.sandboxId.slice(0, 8)}...`, 'success')
        setBuildFailure(null)
        setIsBooting(false)
        setIsReady(true)
        
      } catch (err) {
        if (!mounted) return
        const msg = err instanceof Error ? err.message : 'Unknown error'
        const errorCode = err instanceof E2BApiError ? err.code : undefined

        if (errorCode === 'E2B_NOT_CONFIGURED') {
          addLog('ℹ️ Live preview disabled: E2B_API_KEY is not configured', 'warning')
          setError('Live preview is disabled for this deployment.')
          setBuildFailure(null)
          setIsBooting(false)
          setIsReady(false)
          return
        }

        console.error('❌ E2B boot failed:', msg)
        const exactLogLine = `E2B boot failed: ${msg}`
        addLog(`❌ ${exactLogLine}`, 'error')
        const failure = classifyBuildFailure({
          message: msg,
          stage: 'boot',
          command: 'create sandbox',
          exactLogLine,
          autoRecoveryAttempted: false,
        })
        setBuildFailure(failure)
        setError(failure.message)
        setIsBooting(false)
        
        NervousSystem.dispatchPain({
          id: `e2b-boot-${Date.now()}`,
          type: 'BUILD_ERROR',
          severity: 'critical',
          message: `E2B sandbox failed to boot: ${msg}`,
          context: 'E2BProvider boot',
          timestamp: Date.now(),
        })
      }
    }
    
    bootSandbox()
    
    return () => {
      mounted = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Separate cleanup effect that tracks sandboxId via ref
  const sandboxIdRef = useRef<string | null>(null)
  const sandboxAccessTokenRef = useRef<string | null>(null)
  useEffect(() => {
    sandboxIdRef.current = sandboxId
  }, [sandboxId])

  useEffect(() => {
    sandboxAccessTokenRef.current = sandboxAccessToken
  }, [sandboxAccessToken])

  useEffect(() => {
    return () => {
      // Use ref to capture current sandboxId at cleanup time
      if (sandboxIdRef.current) {
        e2bApi('kill', {
          sandboxId: sandboxIdRef.current,
          sandboxAccessToken: sandboxAccessTokenRef.current,
        }).catch(console.error)
      }
    }
  }, [])
  
  // ==========================================================================
  // File Operations
  // ==========================================================================
  const writeFile = useCallback(async (path: string, content: string) => {
    if (!sandboxId) throw new Error('Sandbox not ready')
    await e2bApi('writeFile', { sandboxId, sandboxAccessToken, path, content })
  }, [sandboxId, sandboxAccessToken])
  
  const readFile = useCallback(async (path: string): Promise<string | null> => {
    if (!sandboxId) return null
    try {
      const result = await e2bApi('readFile', { sandboxId, sandboxAccessToken, path })
      return result.content
    } catch {
      return null
    }
  }, [sandboxId, sandboxAccessToken])
  
  // ==========================================================================
  // Command Execution
  // ==========================================================================
  const runCommand = useCallback(async (
    cmd: string,
    args: string[] = [],
    timeoutMs: number = 120000
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
    if (!sandboxId) throw new Error('Sandbox not ready')
    
    const fullCommand = args.length > 0 ? `${cmd} ${args.join(' ')}` : cmd
    addCommand(fullCommand)
    setRunning(true)
    
    try {
      const result = await e2bApi('runCommand', {
        sandboxId,
        sandboxAccessToken,
        command: fullCommand,
        timeoutMs,
      })
      
      setRunning(false)
      setExitCode(result.exitCode)
      
      if (result.stdout) addLog(result.stdout, 'info')
      if (result.stderr) addLog(result.stderr, result.exitCode === 0 ? 'warning' : 'error')
      
      return result
    } catch (err) {
      setRunning(false)
      setExitCode(1)
      const msg = err instanceof Error ? err.message : 'Command failed'
      addLog(msg, 'error')
      return { exitCode: 1, stdout: '', stderr: msg }
    }
  }, [sandboxId, sandboxAccessToken, addCommand, addLog, setRunning, setExitCode])
  
  // ==========================================================================
  // Sync Files to Sandbox
  // ==========================================================================
  const syncFilesToSandbox = useCallback(async () => {
    if (!sandboxId || files.length === 0) return
    
    addLog(`📦 Syncing ${files.length} files to sandbox...`, 'info')
    
    try {
      // Create directories first
      const dirs = new Set<string>()
      for (const file of files) {
        const parts = file.path.split('/')
        for (let i = 1; i < parts.length; i++) {
          dirs.add(parts.slice(0, i).join('/'))
        }
      }
      
      for (const dir of Array.from(dirs).sort()) {
        if (dir) {
          await e2bApi('makeDir', { sandboxId, sandboxAccessToken, path: dir })
        }
      }
      
      // Write all files
      for (const file of files) {
        const path = file.path.startsWith('/') ? file.path.slice(1) : file.path
        await e2bApi('writeFile', { sandboxId, sandboxAccessToken, path, content: file.content })
      }
      
      // Ensure baseline files for the detected framework.
      await ensureFrameworkFiles(sandboxId, sandboxAccessToken, files, addLog)
      
      addLog('✅ Files synced', 'success')
      
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed'
      const syncLogLine = `Sync error: ${msg}`
      addLog(`❌ ${syncLogLine}`, 'error')
      throw new Error(syncLogLine)
    }
  }, [sandboxId, sandboxAccessToken, files, addLog])
  
  // ==========================================================================
  // Kill Sandbox
  // ==========================================================================
  const killSandbox = useCallback(async () => {
    if (!sandboxId) return
    try {
      await e2bApi('kill', { sandboxId, sandboxAccessToken })
      setSandboxId(null)
      setSandboxAccessToken(null)
      setIsReady(false)
      setServerUrl(null)
      addLog('🛑 Sandbox killed', 'info')
    } catch (err) {
      console.error('Kill sandbox error:', err)
    }
  }, [sandboxId, sandboxAccessToken, addLog])

  const recreateSandbox = useCallback(async (): Promise<string> => {
    setIsBooting(true)
    setIsReady(false)
    setServerUrl(null)

    const result = await e2bApi('create')
    const nextSandboxId = result.sandboxId as string
    const nextSandboxAccessToken = typeof result.sandboxAccessToken === 'string'
      ? result.sandboxAccessToken
      : null

    setSandboxId(nextSandboxId)
    setSandboxAccessToken(nextSandboxAccessToken)
    setVerification(prev => ({
      ...prev,
      sandboxId: nextSandboxId,
      environmentVerifiedAt: Date.now(),
      runtimeVersion: 'E2B Linux',
    }))

    setIsBooting(false)
    setIsReady(true)
    addLog(`✅ Recovery sandbox ready: ${nextSandboxId.slice(0, 8)}...`, 'success')

    return nextSandboxId
  }, [addLog])
  
  // ==========================================================================
  // Auto-build when files change and preview runtime is not live yet.
  // ==========================================================================
  useEffect(() => {
    if (!sandboxId || !isReady) return
    if (files.length === 0) return
    if (serverUrl) return
    if (fullBuildInFlightRef.current) return
    if (shouldDelayPreviewBuildWhileGenerating(isGenerating, lastFileMutationAtRef.current)) return

    const buildAttemptKey = `${filesFingerprint}:${manualBuildNonce}`
    if (buildAttemptKey === lastBuildAttemptHashRef.current) return

    lastBuildAttemptHashRef.current = buildAttemptKey
    fullBuildInFlightRef.current = true
    
    // Run build process
    ;(async () => {
      const buildStart = Date.now()
      let failedStage: BuildFailureStage = 'unknown'
      let failingCommand: string | null = null
      let exactLogLine: string | undefined

      try {
        const runtimeProfile = resolveRuntimeProfile(files)
        setError(null)
        setBuildFailure(null)
        setServerUrl(null)
        addLog('🔄 Starting build process...', 'info')
        
        // Sync files
        failedStage = 'sync'
        failingCommand = 'syncFilesToSandbox'
        await syncFilesToSandbox()
        
        // Install dependencies with controlled recovery for peer-dependency conflicts.
        failedStage = 'install'
        let installCommand = INSTALL_COMMAND_PRIMARY
        let installResult: { exitCode: number; stdout: string; stderr: string } | null = null

        while (true) {
          failingCommand = installCommand
          addLog(`📦 Installing dependencies (${installCommand})...`, 'info')
          installResult = await runCommand(installCommand, [], installCommand === INSTALL_COMMAND_PRIMARY ? 90000 : 120000)

          if (installResult.exitCode === 0) {
            if (installCommand !== INSTALL_COMMAND_PRIMARY) {
              addLog(`✅ Dependency install recovered with ${installCommand}`, 'success')
            }
            lastInstalledDependenciesFingerprintRef.current = dependencyFingerprint
            break
          }

          const installOutput = [installResult.stderr, installResult.stdout].filter(Boolean).join('\n')
          const recoveryCommand = nextInstallRecoveryCommand(installCommand, installOutput)
          if (!recoveryCommand) {
            const installError = installResult.stderr || installResult.stdout || `${installCommand} failed`
            exactLogLine = `Dependency install failed: ${installError.slice(0, 300)}`
            throw new Error(exactLogLine)
          }

          addLog(`⚠️ Dependency resolution failed. Retrying with ${recoveryCommand}...`, 'warning')
          installCommand = recoveryCommand
        }
        
        // Update verification
        const pkgFile = files.find(f => f.path.includes('package.json'))
        if (pkgFile) {
          try {
            const pkg = JSON.parse(pkgFile.content)
            const depCount = Object.keys(pkg.dependencies || {}).length + 
                           Object.keys(pkg.devDependencies || {}).length
            setVerification(prev => ({
              ...prev,
              dependenciesLockedAt: Date.now(),
              dependencyCount: depCount,
              lockfileHash: generateHash(pkgFile.content),
            }))
          } catch (e) {
            console.error('Error parsing package.json:', e)
          }
        }
        
        // Start dev server
        failedStage = 'runtime_start'
        failingCommand = runtimeProfile.command
        addLog(`🚀 Starting ${runtimeProfile.framework === 'nextjs' ? 'Next.js' : 'Vite'} dev server...`, 'info')
        
        // Run dev server in background and check for early failures.
        // Capture the promise so we can suppress unhandled rejections if
        // the dev server crashes after we've already moved on.
        const devServerPromise = e2bApi('runCommand', {
          sandboxId,
          sandboxAccessToken,
          command: runtimeProfile.command,
          timeoutMs: 300000,
        })

        // Prevent unhandled rejection if the long-running promise rejects
        // after we stop waiting for it (e.g. server crashes mid-session).
        devServerPromise.catch(() => {})

        const earlyExit = await Promise.race([
          devServerPromise
            .then((result) => ({ state: 'exited' as const, result }))
            .catch((err) => ({ state: 'failed' as const, error: err })),
          new Promise<{ state: 'running' }>((resolve) => setTimeout(() => resolve({ state: 'running' }), 7000)),
        ])

        if (earlyExit.state === 'exited') {
          const details = earlyExit.result.stderr || earlyExit.result.stdout || `exit code ${earlyExit.result.exitCode}`
          exactLogLine = `Dev server exited early: ${details.slice(0, 300)}`
          throw new Error(exactLogLine)
        }

        if (earlyExit.state === 'failed') {
          const details = earlyExit.error instanceof Error ? earlyExit.error.message : 'unknown error'
          exactLogLine = `Dev server failed to start: ${details}`
          throw new Error(exactLogLine)
        }

        // Poll for host availability
        failedStage = 'host_probe'
        failingCommand = `getHost:${runtimeProfile.port}`
        let host: string | null = null
        let hostError: string | null = null

        while (!host && (Date.now() - buildStart) < RUNTIME_STARTUP_TIMEOUT_MS) {
          try {
            const hostResult = await e2bApi(
              'getHost',
              {
                sandboxId,
                sandboxAccessToken,
                port: runtimeProfile.port,
              },
              {
                maxRetries: HOST_PROBE_MAX_RETRIES,
                requestTimeoutMs: HOST_PROBE_REQUEST_TIMEOUT_MS,
              }
            )
            if (hostResult.host) {
              host = hostResult.host as string
              break
            }
          } catch (err) {
            hostError = err instanceof Error ? err.message : 'Host probe failed'
          }

          await new Promise(resolve => setTimeout(resolve, 1500))
        }

        if (host) {
          failedStage = 'route_probe'
          failingCommand = `route-probe:${runtimeProfile.port}`
          addLog('🔎 Validating runtime output...', 'info')
          let probePassed = false
          let lastProbeDetails = ''

          for (let attempt = 1; attempt <= ROUTE_PROBE_MAX_ATTEMPTS; attempt++) {
            const probeResult = await e2bApi('runCommand', {
              sandboxId,
              sandboxAccessToken,
              command: createRuntimeProbeCommand(runtimeProfile.port, {
                fetchTimeoutMs: ROUTE_PROBE_FETCH_TIMEOUT_MS,
              }),
              timeoutMs: ROUTE_PROBE_COMMAND_TIMEOUT_MS,
            }) as { exitCode: number; stdout: string; stderr: string }

            if (probeResult.exitCode === 0) {
              probePassed = true
              break
            }

            const probeDetails = sanitizeRuntimeValidationDetails(
              probeResult.stderr || probeResult.stdout || 'Runtime validation failed'
            )
            lastProbeDetails = probeDetails
            const shouldRetry = attempt < ROUTE_PROBE_MAX_ATTEMPTS
              && isRetryableRouteProbeFailure(probeDetails)

            if (!shouldRetry) {
              break
            }

            addLog(`⏳ Runtime warming up (${attempt}/${ROUTE_PROBE_MAX_ATTEMPTS}); retrying validation...`, 'info')
            await new Promise((resolve) => setTimeout(resolve, ROUTE_PROBE_RETRY_DELAY_MS))
          }

          if (!probePassed) {
            const probeDetails = lastProbeDetails || 'Runtime validation failed'
            if (shouldAllowSoftRuntimeValidationFailure(probeDetails)) {
              addLog(
                `⚠️ Runtime validation was inconclusive (${probeDetails.slice(0, 140)}). Opening preview anyway for direct inspection.`,
                'warning'
              )
              setServerUrl(host)
              setError(null)
              setBuildFailure(null)
              resetFailureLogDedup()
              lastSyncedHashRef.current = filesFingerprint
              addLog(`✅ Preview ready (soft validation): ${host}`, 'success')
              return
            }

            exactLogLine = `Runtime validation failed: ${probeDetails.slice(0, 300)}`
            throw new Error(exactLogLine)
          }

          addLog('✅ Runtime validation passed', 'success')
          setServerUrl(host)
          setError(null)
          setBuildFailure(null)
          resetFailureLogDedup()
          lastSyncedHashRef.current = filesFingerprint
          addLog(`✅ Preview ready: ${host}`, 'success')
          return
        }

        exactLogLine = hostError
          ? `Preview host not ready: ${hostError}`
          : 'Preview host did not become ready in time.'
        throw new Error(exactLogLine)
        
      } catch (err) {
        const msg = err instanceof E2BApiError && err.code
          ? `${err.message} (${err.code})`
          : err instanceof Error
            ? err.message
            : 'Build failed'
        const normalizedLogLine = exactLogLine || `Build error: ${msg}`

        if (isSandboxOwnershipFailure(msg) && !autoRecoveryAttemptedRef.current) {
          autoRecoveryAttemptedRef.current = true
          addLog('♻️ Auto-recovery: sandbox ownership check failed. Recreating sandbox and retrying once...', 'warning')

          try {
            await recreateSandbox()
            setError(null)
            setBuildFailure(
              classifyBuildFailure({
                message: msg,
                stage: failedStage,
                command: failingCommand,
                exactLogLine: normalizedLogLine,
                autoRecoveryAttempted: true,
                autoRecoverySucceeded: null,
              })
            )

            // Trigger a clean rerun for the same files with the new sandbox.
            lastBuildAttemptHashRef.current = ''
            lastSyncedHashRef.current = ''
            return
          } catch (recoveryErr) {
            const recoveryMsg = recoveryErr instanceof Error ? recoveryErr.message : 'Sandbox recreation failed'
            const recoveryLogLine = `Auto-recovery failed: ${recoveryMsg}`
            const failure = classifyBuildFailure({
              message: recoveryMsg,
              stage: 'boot',
              command: 'create sandbox',
              exactLogLine: recoveryLogLine,
              autoRecoveryAttempted: true,
              autoRecoverySucceeded: false,
            })

            applyBuildFailureState(failure)

            NervousSystem.dispatchPain({
              id: `e2b-build-${Date.now()}`,
              type: 'BUILD_ERROR',
              severity: 'critical',
              message: `Build failed: ${failure.exactLogLine}`,
              context: 'E2BProvider build',
              timestamp: Date.now(),
            })
            return
          }
        }

        const failure = classifyBuildFailure({
          message: msg,
          stage: failedStage,
          command: failingCommand,
          exactLogLine: normalizedLogLine,
          autoRecoveryAttempted: autoRecoveryAttemptedRef.current,
          autoRecoverySucceeded: autoRecoveryAttemptedRef.current ? false : null,
        })

        applyBuildFailureState(failure)
        
        NervousSystem.dispatchPain({
          id: `e2b-build-${Date.now()}`,
          type: 'BUILD_ERROR',
          severity: 'critical',
          message: `Build failed: ${failure.exactLogLine}`,
          context: 'E2BProvider build',
          timestamp: Date.now(),
        })
      } finally {
        fullBuildInFlightRef.current = false
        if (queuedManualRetryRef.current) {
          queuedManualRetryRef.current = false
          setManualBuildNonce((value) => value + 1)
        }
      }
    })()
  }, [
    sandboxId,
    sandboxAccessToken,
    isReady,
    isGenerating,
    files,
    filesFingerprint,
    dependencyFingerprint,
    serverUrl,
    manualBuildNonce,
    generationQuietToken,
    syncFilesToSandbox,
    runCommand,
    addLog,
    recreateSandbox,
    applyBuildFailureState,
    resetFailureLogDedup,
  ])

  // ==========================================================================
  // Hot-sync file mutations after preview is already live.
  // ==========================================================================
  useEffect(() => {
    if (!sandboxId || !isReady || isGenerating || !serverUrl) return
    if (files.length === 0) return
    if (fullBuildInFlightRef.current || liveSyncInFlightRef.current) return
    if (filesFingerprint === lastSyncedHashRef.current) return

    if (
      dependencyFingerprint
      && dependencyFingerprint !== lastInstalledDependenciesFingerprintRef.current
    ) {
      addLog('📦 Dependency manifests changed. Rebuilding preview runtime for a clean install...', 'warning')
      requestPreviewRebuild('dependency manifests changed')
      return
    }

    liveSyncInFlightRef.current = true

    ;(async () => {
      try {
        addLog('♻️ Syncing updated files to live preview...', 'info')
        await syncFilesToSandbox()
        lastSyncedHashRef.current = filesFingerprint
        setError(null)
        setBuildFailure(null)
        resetFailureLogDedup()
        addLog('✅ Live preview updated', 'success')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Sync failed'
        const exactLogLine = `Live sync failed: ${msg}`
        const failure = classifyBuildFailure({
          message: msg,
          stage: 'sync',
          command: 'syncFilesToSandbox',
          exactLogLine,
          autoRecoveryAttempted: autoRecoveryAttemptedRef.current,
          autoRecoverySucceeded: autoRecoveryAttemptedRef.current ? false : null,
        })
        applyBuildFailureState(failure)
      } finally {
        liveSyncInFlightRef.current = false
      }
    })()
  }, [
    sandboxId,
    isReady,
    isGenerating,
    serverUrl,
    files,
    filesFingerprint,
    dependencyFingerprint,
    syncFilesToSandbox,
    addLog,
    requestPreviewRebuild,
    applyBuildFailureState,
    resetFailureLogDedup,
  ])
  
  // ==========================================================================
  // Context Value
  // ==========================================================================
  const value: E2BContextValue = {
    sandboxId,
    isBooting,
    isReady,
    serverUrl,
    error,
    buildFailure,
    verification,
    writeFile,
    readFile,
    runCommand,
    syncFilesToSandbox,
    killSandbox,
    requestPreviewRebuild,
  }
  
  return (
    <E2BContext.Provider value={value}>
      {children}
    </E2BContext.Provider>
  )
}

export function E2BProvider({ children }: E2BProviderProps) {
  if (process.env.NEXT_PUBLIC_E2B_MOCK === 'true') {
    return <E2BMockProvider>{children}</E2BMockProvider>
  }

  return <E2BRealProvider>{children}</E2BRealProvider>
}

// ============================================================================
// Framework Baseline Files
// ============================================================================
function normalizePath(value: string): string {
  return normalizeRuntimePath(value)
}

function hasFile(files: Array<{ path: string; content: string }>, targetPath: string): boolean {
  const normalizedTarget = normalizePath(targetPath)
  return files.some((file) => normalizePath(file.path) === normalizedTarget)
}

function getFileByPath(
  files: Array<{ path: string; content: string }>,
  targetPath: string
): { path: string; content: string } | undefined {
  const normalizedTarget = normalizePath(targetPath)
  return files.find((file) => normalizePath(file.path) === normalizedTarget)
}

async function ensureFrameworkFiles(
  sandboxId: string,
  sandboxAccessToken: string | null,
  files: Array<{ path: string; content: string }>,
  addLog: (message: string, type?: LogType) => void
) {
  const runtimeProfile = resolveRuntimeProfile(files)
  if (runtimeProfile.framework === 'nextjs') {
    await ensureNextJsFiles(sandboxId, sandboxAccessToken, files, addLog)
    return
  }

  await ensureSvelteKitFallbackFiles(sandboxId, sandboxAccessToken, files, addLog)
}

async function ensureNextJsFiles(
  sandboxId: string,
  sandboxAccessToken: string | null,
  files: Array<{ path: string; content: string }>,
  addLog: (message: string, type?: LogType) => void
) {
  const appRoot = hasFile(files, 'app/layout.tsx') || hasFile(files, 'app/page.tsx') ? 'app' : 'src/app'
  const layoutPath = `${appRoot}/layout.tsx`
  const hasPackageJson = hasFile(files, 'package.json')
  const hasTsConfig = hasFile(files, 'tsconfig.json')
  const hasNextEnv = hasFile(files, 'next-env.d.ts')
  const hasLayout = hasFile(files, layoutPath)
  const hasPage = hasFile(files, `${appRoot}/page.tsx`)
  const hasGlobals = hasFile(files, `${appRoot}/globals.css`)
  const hasTailwindConfig = hasFile(files, 'tailwind.config.js') || hasFile(files, 'tailwind.config.ts')
  const hasPostcss = hasFile(files, 'postcss.config.js') || hasFile(files, 'postcss.config.mjs')

  if (!hasPackageJson) {
    addLog('📦 Adding Next.js package manifest baseline...', 'info')
    await e2bApi('writeFile', {
      sandboxId,
      sandboxAccessToken,
      path: 'package.json',
      content: `{
  "name": "torbit-generated-app",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "16.1.6",
    "react": "19.2.3",
    "react-dom": "19.2.3"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "typescript": "^5",
    "tailwindcss": "^4",
    "autoprefixer": "^10",
    "postcss": "^8"
  }
}
`,
    })
  }

  if (!hasTsConfig) {
    await e2bApi('writeFile', {
      sandboxId,
      sandboxAccessToken,
      path: 'tsconfig.json',
      content: `{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`,
    })
  }

  if (!hasNextEnv) {
    await e2bApi('writeFile', {
      sandboxId,
      sandboxAccessToken,
      path: 'next-env.d.ts',
      content: `/// <reference types="next" />
/// <reference types="next/image-types/global" />
`,
    })
  }

  await e2bApi('makeDir', { sandboxId, sandboxAccessToken, path: appRoot })

  if (!hasGlobals) {
    await e2bApi('writeFile', {
      sandboxId,
      sandboxAccessToken,
      path: `${appRoot}/globals.css`,
      content: `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
    })
  }

  if (!hasLayout) {
    addLog('📄 Adding Next.js layout baseline...', 'info')
    const baselineLayout = injectPreviewBridgeIntoNextLayout(`import './globals.css'
import type { ReactNode } from 'react'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`)
    await e2bApi('writeFile', {
      sandboxId,
      sandboxAccessToken,
      path: layoutPath,
      content: baselineLayout,
    })
  } else {
    const existingLayout = getFileByPath(files, layoutPath)
    if (existingLayout) {
      const runtimeLayout = injectPreviewBridgeIntoNextLayout(existingLayout.content)
      if (runtimeLayout !== existingLayout.content) {
        addLog('🛰️ Injecting preview bridge into layout...', 'info')
        await e2bApi('writeFile', {
          sandboxId,
          sandboxAccessToken,
          path: layoutPath,
          content: runtimeLayout,
        })
      }
    }
  }

  if (!hasPage) {
    addLog('📄 Adding Next.js page baseline...', 'info')
    await e2bApi('writeFile', {
      sandboxId,
      sandboxAccessToken,
      path: `${appRoot}/page.tsx`,
      content: `export default function HomePage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <h1>Welcome to Torbit</h1>
    </main>
  )
}
`,
    })
  }

  if (!hasTailwindConfig) {
    await e2bApi('writeFile', {
      sandboxId,
      sandboxAccessToken,
      path: 'tailwind.config.ts',
      content: `/** @type {import('tailwindcss').Config} */
const config = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
}

export default config
`,
    })
  }

  if (!hasPostcss) {
    await e2bApi('writeFile', {
      sandboxId,
      sandboxAccessToken,
      path: 'postcss.config.mjs',
      content: `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`,
    })
  }
}

async function ensureSvelteKitFallbackFiles(
  sandboxId: string,
  sandboxAccessToken: string | null,
  files: Array<{ path: string; content: string }>,
  addLog: (message: string, type?: LogType) => void
) {
  const hasLayout = files.some(f => f.path.includes('+layout.svelte'))
  const hasPage = files.some(f => f.path.includes('+page.svelte') && f.path.includes('routes'))
  const hasSvelteConfig = files.some(f => f.path.includes('svelte.config'))
  const hasViteConfig = files.some(f => f.path.includes('vite.config'))
  const hasTailwindConfig = files.some(f => f.path.includes('tailwind.config'))

  await e2bApi('makeDir', { sandboxId, sandboxAccessToken, path: 'src/routes' })

  if (!hasLayout) {
    addLog('📄 Adding SvelteKit layout baseline...', 'info')
    await e2bApi('writeFile', {
      sandboxId,
      sandboxAccessToken,
      path: 'src/routes/+layout.svelte',
      content: `<script>
  import '../app.css';
</script>

<slot />
`,
    })
  }

  if (!hasPage) {
    addLog('📄 Adding SvelteKit page baseline...', 'info')
    await e2bApi('writeFile', {
      sandboxId,
      sandboxAccessToken,
      path: 'src/routes/+page.svelte',
      content: `<script lang="ts">
  // SvelteKit + DaisyUI starter
</script>

<main class="min-h-screen bg-base-200 flex items-center justify-center">
  <div class="text-center">
    <h1 class="text-5xl font-bold text-primary mb-4">Welcome to Torbit</h1>
    <p class="text-base-content/70">Your app is loading...</p>
  </div>
</main>
`,
    })
  }

  await e2bApi('writeFile', {
    sandboxId,
    sandboxAccessToken,
    path: 'src/app.css',
    content: `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
  })

  if (!hasSvelteConfig) {
    await e2bApi('writeFile', {
      sandboxId,
      sandboxAccessToken,
      path: 'svelte.config.js',
      content: `import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter()
  }
};

export default config;
`,
    })
  }

  if (!hasViteConfig) {
    await e2bApi('writeFile', {
      sandboxId,
      sandboxAccessToken,
      path: 'vite.config.ts',
      content: `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()]
});
`,
    })
  }

  if (!hasTailwindConfig) {
    await e2bApi('writeFile', {
      sandboxId,
      sandboxAccessToken,
      path: 'tailwind.config.ts',
      content: `import daisyui from 'daisyui'

/** @type {import('tailwindcss').Config} */
const config = {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {},
  },
  plugins: [daisyui],
}

export default config
`,
    })
  }

  await e2bApi('writeFile', {
    sandboxId,
    sandboxAccessToken,
    path: 'postcss.config.mjs',
    content: `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`,
  })
}
