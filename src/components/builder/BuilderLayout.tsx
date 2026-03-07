'use client'

import { ReactNode } from 'react'

interface BuilderLayoutProps {
  children: ReactNode
}

/**
 * BuilderLayout - Clean, minimal layout wrapper
 */
export default function BuilderLayout({ children }: BuilderLayoutProps) {
  return (
    <div
      className="builder-ambient relative h-screen w-screen overflow-hidden bg-[#000000]"
      role="main"
      data-testid="builder-layout"
    >
      <div className="builder-grid pointer-events-none absolute inset-0" />
      <div className="builder-orbital-glow pointer-events-none absolute inset-0" />
      <div className="builder-noise pointer-events-none absolute inset-0" />
      <div className="builder-radial-sweep pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-white/[0.08] via-white/[0.015] to-transparent" />
      <div className="pointer-events-none absolute inset-x-12 top-6 bottom-6 rounded-[28px] border border-white/[0.07] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]" />
      <div className="pointer-events-none absolute inset-y-0 left-[18%] w-px bg-gradient-to-b from-transparent via-white/[0.12] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-[34%] w-px bg-gradient-to-b from-transparent via-white/[0.08] to-transparent" />
      <div className="relative z-10 flex h-full w-full">
        {children}
      </div>
    </div>
  )
}
