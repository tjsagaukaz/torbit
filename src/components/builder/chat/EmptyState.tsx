'use client'

import { TorbitLogo } from '@/components/ui/TorbitLogo'

const PRODUCTION_STARTERS = [
  {
    label: 'Flagship SaaS',
    description: 'A differentiated customer product with real workflows and premium polish.',
    prompt: 'Build a flagship B2B SaaS product with a premium brand system, opinionated information hierarchy, realistic seeded data, and polished motion. Include onboarding, dashboard, account settings, empty states, loading states, error states, and production-safe forms.',
  },
  {
    label: 'Operator Console',
    description: 'An internal system for teams who need speed, clarity, and controlled risk.',
    prompt: 'Build an internal operator console with role-based access control, audit history, live status surfaces, dense but readable tables, filterable workflows, and safe destructive actions. Make it fast, serious, and operationally credible.',
  },
  {
    label: 'Launch Landing System',
    description: 'A marketing system with a point of view, not a template.',
    prompt: 'Design a launch-ready marketing site with a bold visual identity, distinctive typography hierarchy, strong motion direction, social proof, pricing, FAQ, and conversion-focused structure. Avoid generic SaaS gradients and interchangeable blocks.',
  },
  {
    label: 'Mobile Product',
    description: 'An Expo app with real navigation, states, and App Store-ready structure.',
    prompt: 'Build a mobile product in Expo with a strong visual system, production-safe navigation patterns, onboarding, core tab flows, account settings, empty/loading/error states, and native-feeling interactions. Treat mobile as a first-class product, not a responsive web port.',
  },
]

const QUALITY_DOCTRINES = [
  'Distinct visual identity',
  'Real data and edge states',
  'Governed runtime verification',
]

const BRIEF_CHECKLIST = [
  'Who it is for',
  'The core workflow',
  'What makes it different',
  'How it should feel',
]

interface EmptyStateProps {
  onSelectTemplate?: (prompt: string) => void
}

export function EmptyState({ onSelectTemplate }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col justify-center p-5">
      <div className="mx-auto w-full max-w-[390px]">
        <div className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
          <div className="pointer-events-none absolute -top-16 right-[-8%] h-36 w-36 rounded-full bg-cyan-300/10 blur-3xl" />
          <div className="pointer-events-none absolute bottom-[-10%] left-[-8%] h-28 w-28 rounded-full bg-amber-200/10 blur-3xl" />

          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-black/30">
              <TorbitLogo size="lg" variant="muted" animated />
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#8d8d8d]">Torbit Build Brief</p>
              <p className="text-[14px] font-medium text-[#f5f5f5]">Describe the product and the standard.</p>
            </div>
          </div>

          <p className="text-[12px] leading-relaxed text-[#a0a0a0]">
            Torbit performs best when the brief includes the outcome, audience, differentiator, and visual direction.
            It is tuned for launch-grade work, not generic scaffolds.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {QUALITY_DOCTRINES.map((doctrine) => (
              <span
                key={doctrine}
                className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[10px] font-medium text-[#c7c7c7]"
              >
                {doctrine}
              </span>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-white/[0.08] bg-black/25 p-3.5">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#7c7c7c]">Strong Brief Ingredients</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {BRIEF_CHECKLIST.map((item) => (
                <div
                  key={item}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2 text-[11px] text-[#cfcfcf]"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {PRODUCTION_STARTERS.map((starter, index) => (
            <button
              key={starter.label}
              onClick={() => onSelectTemplate?.(starter.prompt)}
              className="group w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5 text-left transition-all hover:border-white/[0.16] hover:bg-white/[0.05]"
            >
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/[0.08] bg-black/30 text-[10px] font-semibold text-[#d9d9d9]">
                    0{index + 1}
                  </span>
                  <span className="text-[13px] font-medium text-[#f5f5f5]">{starter.label}</span>
                </div>
                <svg
                  className="h-4 w-4 text-[#5f5f5f] transition-colors group-hover:text-[#d0d0d0]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </div>
              <p className="text-[11px] leading-relaxed text-[#8f8f8f]">{starter.description}</p>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] text-white/45">/ focus composer</span>
          <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] text-white/45">Alt+I inspector</span>
          <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] text-white/45">Shift+Enter newline</span>
        </div>
      </div>
    </div>
  )
}
