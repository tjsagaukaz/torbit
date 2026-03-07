'use client'

import { TorbitLogo } from '@/components/ui/TorbitLogo'

const PRODUCTION_STARTERS = [
  {
    label: 'SaaS dashboard',
    description: 'A product dashboard with onboarding, key screens, and realistic sample data.',
    prompt: 'Build a polished SaaS dashboard with onboarding, a dashboard, settings, realistic sample data, and clear empty, loading, and error states.',
  },
  {
    label: 'Internal tool',
    description: 'A simple internal app with tables, filters, and safe actions.',
    prompt: 'Build an internal operations tool with a dashboard, tables, filters, detail views, and safe destructive actions. Keep it clear and fast.',
  },
  {
    label: 'Marketing site',
    description: 'A landing page with strong hierarchy, pricing, and FAQ.',
    prompt: 'Design a marketing site with a clear hero, benefits, pricing, FAQ, and strong calls to action. Make it feel polished and modern.',
  },
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
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#8d8d8d]">Start a build</p>
              <p className="text-[14px] font-medium text-[#f5f5f5]">Describe what you want to make.</p>
            </div>
          </div>

          <p className="text-[12px] leading-relaxed text-[#a0a0a0]">
            Keep it simple. Mention the product, who it is for, and the style you want.
          </p>
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

        <p className="mt-4 text-[10px] text-white/45">Press `/` to jump to the prompt box.</p>
      </div>
    </div>
  )
}
