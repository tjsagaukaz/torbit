import { describe, expect, it } from 'vitest'
import { buildTorbitBuildContract, formatWorkspaceSnapshot } from './build-contract'

describe('buildTorbitBuildContract', () => {
  it('applies mobile-specific quality standards for greenfield work', () => {
    const contract = buildTorbitBuildContract({
      userPrompt: 'Build an Expo mobile app for habit coaching with onboarding and account settings.',
      projectType: 'mobile',
      fileManifest: {
        totalFiles: 4,
        truncated: false,
        files: [
          { path: 'app/_layout.tsx', bytes: 320 },
          { path: 'app/index.tsx', bytes: 540 },
          { path: 'components/ui/button.tsx', bytes: 220 },
          { path: 'lib/theme.ts', bytes: 180 },
        ],
      },
    })

    expect(contract).toContain('Workspace phase: greenfield')
    expect(contract).toContain('Expo Router patterns')
    expect(contract).toContain('native-feeling mobile interaction design')
    expect(contract).toContain('fresh product foundation')
  })

  it('reinforces iterative quality for established web workspaces', () => {
    const contract = buildTorbitBuildContract({
      userPrompt: 'Refine the admin analytics dashboard and tighten the billing workflow.',
      projectType: 'web',
      fileManifest: {
        totalFiles: 72,
        truncated: true,
        files: [
          { path: 'src/app/dashboard/page.tsx', bytes: 1280 },
          { path: 'src/components/dashboard/RevenueChart.tsx', bytes: 940 },
          { path: 'src/components/billing/BillingForm.tsx', bytes: 770 },
          { path: 'src/store/billing.ts', bytes: 340 },
        ],
      },
    })

    expect(contract).toContain('Workspace phase: iteration')
    expect(contract).toContain('Preserve and extend the strongest existing patterns')
    expect(contract).toContain('responsive web layouts')
    expect(contract).toContain('Operational surfaces should feel serious')
    expect(contract).toContain('Commerce flows must feel credible')
  })
})

describe('formatWorkspaceSnapshot', () => {
  it('summarizes the workspace with surfaces and focused inventory', () => {
    const snapshot = formatWorkspaceSnapshot({
      totalFiles: 18,
      truncated: false,
      files: [
        { path: 'src/app/page.tsx', bytes: 1800 },
        { path: 'src/app/pricing/page.tsx', bytes: 1320 },
        { path: 'src/components/marketing/Hero.tsx', bytes: 820 },
        { path: 'src/components/marketing/Pricing.tsx', bytes: 760 },
        { path: 'src/store/site.ts', bytes: 240 },
        { path: 'src/providers/ThemeProvider.tsx', bytes: 410 },
        { path: 'src/app/api/lead/route.ts', bytes: 560 },
        { path: 'src/lib/content.ts', bytes: 310 },
      ],
    })

    expect(snapshot).toContain('Phase: expansion')
    expect(snapshot).toContain('Top workspace areas:')
    expect(snapshot).toContain('Key implementation surfaces:')
    expect(snapshot).toContain('Routes:')
    expect(snapshot).toContain('Components:')
    expect(snapshot).toContain('State and providers:')
    expect(snapshot).toContain('API and services:')
    expect(snapshot).toContain('Focused file inventory:')
  })
})
