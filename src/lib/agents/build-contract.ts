export interface WorkspaceFileManifest {
  files: Array<{ path: string; bytes: number }>
  totalFiles: number
  truncated?: boolean
}

type ProjectType = 'web' | 'mobile'
type WorkspacePhase = 'greenfield' | 'expansion' | 'iteration'

interface BuildContractInput {
  userPrompt: string
  projectType?: ProjectType
  fileManifest?: WorkspaceFileManifest | null
}

interface SurfaceBucket {
  label: string
  test: (normalizedPath: string) => boolean
}

const APP_ENTRY_FILES = new Set(['page', 'layout', 'loading', 'error', 'route', 'default', 'not-found'])

const SURFACE_BUCKETS: SurfaceBucket[] = [
  {
    label: 'Routes',
    test: (normalizedPath) => {
      const segments = normalizedPath.split('/')
      const appIndex = segments.findIndex((segment) => segment === 'app')
      if (appIndex === -1) return false
      const fileName = segments[segments.length - 1] || ''
      const stem = fileName.split('.')[0]
      return APP_ENTRY_FILES.has(stem)
    },
  },
  {
    label: 'Components',
    test: (normalizedPath) => normalizedPath.includes('/components/') || normalizedPath.startsWith('components/'),
  },
  {
    label: 'State and providers',
    test: (normalizedPath) => (
      normalizedPath.includes('/store/')
      || normalizedPath.startsWith('store/')
      || normalizedPath.includes('/providers/')
      || normalizedPath.startsWith('providers/')
      || normalizedPath.includes('context/')
    ),
  },
  {
    label: 'API and services',
    test: (normalizedPath) => (
      normalizedPath.includes('/app/api/')
      || normalizedPath.startsWith('app/api/')
      || normalizedPath.includes('/lib/')
      || normalizedPath.startsWith('lib/')
      || normalizedPath.includes('/services/')
      || normalizedPath.startsWith('services/')
      || normalizedPath.includes('/hooks/')
      || normalizedPath.startsWith('hooks/')
    ),
  },
]

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.?\//, '')
}

function detectWorkspacePhase(fileManifest?: WorkspaceFileManifest | null): WorkspacePhase {
  const totalFiles = fileManifest?.totalFiles ?? fileManifest?.files.length ?? 0

  if (totalFiles <= 12) return 'greenfield'
  if (totalFiles <= 48) return 'expansion'
  return 'iteration'
}

function getTopWorkspaceArea(normalizedPath: string): string {
  const segments = normalizedPath.split('/').filter(Boolean)
  if (segments.length === 0) return 'root'

  if (segments[0] === 'src' && segments.length > 1) {
    return `${segments[0]}/${segments[1]}`
  }

  return segments[0]
}

function collectSurfaceExamples(fileManifest: WorkspaceFileManifest, bucket: SurfaceBucket): string[] {
  const seen = new Set<string>()
  const matches: string[] = []

  for (const file of fileManifest.files) {
    const normalizedPath = normalizePath(file.path)
    if (!bucket.test(normalizedPath)) continue
    if (seen.has(normalizedPath)) continue
    seen.add(normalizedPath)
    matches.push(normalizedPath)
    if (matches.length >= 4) break
  }

  return matches
}

function buildWorkspaceAreaSummary(fileManifest: WorkspaceFileManifest): string[] {
  const counts = new Map<string, number>()

  for (const file of fileManifest.files) {
    const area = getTopWorkspaceArea(normalizePath(file.path))
    counts.set(area, (counts.get(area) || 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([area, count]) => `- ${area}: ${count} file${count === 1 ? '' : 's'}`)
}

function buildSurfaceSummary(fileManifest: WorkspaceFileManifest): string[] {
  return SURFACE_BUCKETS
    .map((bucket) => {
      const matches = collectSurfaceExamples(fileManifest, bucket)
      if (matches.length === 0) return null
      return `- ${bucket.label}: ${matches.join(', ')}`
    })
    .filter((value): value is string => Boolean(value))
}

function buildFocusedFileList(fileManifest: WorkspaceFileManifest): string[] {
  return fileManifest.files
    .slice(0, 40)
    .map((file) => `- ${normalizePath(file.path)} (${file.bytes}b)`)
}

function buildPromptSpecificDirectives(userPrompt: string): string[] {
  const normalizedPrompt = userPrompt.toLowerCase()
  const directives: string[] = []

  if (/\b(landing|marketing|homepage|hero|pricing|waitlist|campaign)\b/.test(normalizedPrompt)) {
    directives.push('Give marketing surfaces a clear narrative arc: hook, proof, offer, objection handling, and conversion path.')
  }

  if (/\b(dashboard|admin|console|ops|analytics|crm|portal|backoffice)\b/.test(normalizedPrompt)) {
    directives.push('Operational surfaces should feel serious: dense but legible information hierarchy, filters, bulk actions, auditability, and safe destructive flows.')
  }

  if (/\b(auth|login|signup|onboarding|account|profile|permissions)\b/.test(normalizedPrompt)) {
    directives.push('Treat trust-sensitive flows carefully: validation, edge states, handoff moments, and helpful recovery copy must be explicit.')
  }

  if (/\b(ecommerce|checkout|billing|subscription|invoice|payment)\b/.test(normalizedPrompt)) {
    directives.push('Commerce flows must feel credible: real pricing context, order states, validation, and post-action confirmation matter as much as the happy path.')
  }

  if (/\b(data[- ]table|table|kanban|calendar|timeline|workflow)\b/.test(normalizedPrompt)) {
    directives.push('If the product is workflow-heavy, build strong interaction affordances: selection states, sorting/filtering, secondary actions, and useful empty states.')
  }

  return directives
}

function buildPhaseDirectives(phase: WorkspacePhase): string[] {
  switch (phase) {
    case 'greenfield':
      return [
        'Treat this as a fresh product foundation: establish layout rhythm, typography, color intent, reusable primitives, and believable seed data before multiplying screens.',
        'If the request is broad, ship one polished vertical slice with supporting states instead of a shallow spread of disconnected surfaces.',
      ]
    case 'expansion':
      return [
        'Extend shared primitives and existing architecture before adding one-off patterns or duplicate abstractions.',
        'Favor coherent multi-surface workflows over isolated screens that do not connect to each other.',
      ]
    case 'iteration':
    default:
      return [
        'Preserve and extend the strongest existing patterns in the workspace; do not introduce visual drift or parallel architectures.',
        'Minimize blast radius while still making the touched workflow feel materially more complete and refined.',
      ]
  }
}

export function buildTorbitBuildContract(input: BuildContractInput): string {
  const phase = detectWorkspacePhase(input.fileManifest)
  const baseDirectives = [
    'Build a premium, opinionated product outcome, not scaffolding or a generic template.',
    'Use believable domain data, purposeful copy, and flows that feel real enough to demo to a customer or stakeholder.',
    'Every affected screen or component needs the right empty, loading, success, error, disabled, and validation states when relevant.',
    'Establish a distinct visual system through typography, spacing, density, color, and motion. Avoid interchangeable SaaS-card aesthetics.',
    'Accessibility, keyboard support, responsive behavior, and clear focus states are part of done.',
    'Leave the workspace production-safe: no lorem ipsum, fake TODO markers, dead routes, or placeholder components posing as finished work.',
    'Avoid default font-stack sameness, overused gradient blobs, filler KPI tiles, and shallow one-screen outputs with no supporting states.',
  ]

  const projectDirectives = input.projectType === 'mobile'
    ? [
      'Use Expo Router patterns and native-feeling mobile interaction design.',
      'Respect thumb reach, safe areas, gesture-friendly controls, and mobile-first navigation clarity.',
    ]
    : [
      'Build responsive web layouts that feel intentional on desktop, laptop, tablet, and mobile breakpoints.',
      'Use information hierarchy, spacing rhythm, and section pacing to create a confident web product identity.',
    ]

  const lines = [
    '## TORBIT DELIVERY CONTRACT',
    `- Workspace phase: ${phase}`,
    ...baseDirectives.map((directive) => `- ${directive}`),
    ...projectDirectives.map((directive) => `- ${directive}`),
    ...buildPhaseDirectives(phase).map((directive) => `- ${directive}`),
    ...buildPromptSpecificDirectives(input.userPrompt).map((directive) => `- ${directive}`),
  ]

  return lines.join('\n')
}

export function formatWorkspaceSnapshot(fileManifest: WorkspaceFileManifest): string {
  const phase = detectWorkspacePhase(fileManifest)
  const surfaceSummary = buildSurfaceSummary(fileManifest)
  const workspaceAreas = buildWorkspaceAreaSummary(fileManifest)
  const focusedFiles = buildFocusedFileList(fileManifest)

  const lines = [
    '## CURRENT WORKSPACE SNAPSHOT',
    `- Phase: ${phase}`,
    `- Total files in current workspace: ${fileManifest.totalFiles}`,
    `- Snapshot truncated: ${fileManifest.truncated ? 'yes' : 'no'}`,
  ]

  if (workspaceAreas.length > 0) {
    lines.push('- Top workspace areas:')
    lines.push(...workspaceAreas)
  }

  if (surfaceSummary.length > 0) {
    lines.push('- Key implementation surfaces:')
    lines.push(...surfaceSummary)
  }

  if (focusedFiles.length > 0) {
    lines.push('- Focused file inventory:')
    lines.push(...focusedFiles)
  }

  return lines.join('\n')
}
