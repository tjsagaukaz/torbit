'use client'

import { AnimatePresence, motion } from 'framer-motion'
import type { TasteProfile } from '@/lib/design/taste-profile'

interface TasteProfileRailProps {
  profile: TasteProfile
  expanded: boolean
  onToggle: () => void
  onReset: () => void
}

export function TasteProfileRail({
  profile,
  expanded,
  onToggle,
  onReset,
}: TasteProfileRailProps) {
  const successRate = profile.runStats.total > 0
    ? Math.round((profile.runStats.successful / profile.runStats.total) * 100)
    : null

  const renderSignalRow = (label: string, values: string[], tone: 'good' | 'warn') => {
    if (values.length === 0) return null

    return (
      <div>
        <p className="text-[10px] uppercase tracking-widest text-white/35 mb-1.5">{label}</p>
        <div className="flex flex-wrap gap-1.5">
          {values.slice(0, 4).map((value) => (
            <span
              key={`${label}-${value}`}
              className={`text-[10px] px-2 py-1 rounded-md border ${
                tone === 'good'
                  ? 'text-emerald-300/80 bg-emerald-500/10 border-emerald-500/20'
                  : 'text-amber-300/80 bg-amber-500/10 border-amber-500/20'
              }`}
            >
              {value}
            </span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mt-2 pt-2 border-t border-[#101010]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/80" />
          <span className="text-[11px] text-white/70">Taste Memory</span>
          {successRate !== null && (
            <span className="text-[10px] text-white/45">{successRate}% implementation hit-rate</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggle}
            className="text-[10px] text-white/45 hover:text-white/75 transition-colors"
            aria-label={expanded ? 'Hide taste profile' : 'Show taste profile'}
          >
            {expanded ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] text-red-300/65 hover:text-red-300 transition-colors"
            aria-label="Reset taste profile"
          >
            Reset
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="mt-2 space-y-2 overflow-hidden"
          >
            {renderSignalRow('Prefers', profile.likes, 'good')}
            {renderSignalRow('Avoids', profile.avoids, 'warn')}
            {renderSignalRow('Directives', profile.directives, 'good')}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
