'use client'

import { motion } from 'framer-motion'
import { useBuilderStore } from '@/store/builder'
import type { ProjectType } from '@/lib/mobile/types'

interface ProjectTypeOption {
  type: ProjectType
  name: string
  description: string
  icon: React.ReactNode
}

const PROJECT_TYPES: ProjectTypeOption[] = [
  {
    type: 'web',
    name: 'Web App',
    description: 'Next.js + React',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
      </svg>
    ),
  },
  {
    type: 'mobile',
    name: 'Mobile App',
    description: 'iOS • Expo',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
      </svg>
    ),
  },
]

interface ProjectTypeSelectorProps {
  compact?: boolean
}

export function ProjectTypeSelector({ compact = false }: ProjectTypeSelectorProps) {
  const { projectType, setProjectType } = useBuilderStore()

  if (compact) {
    return (
      <div 
        className="grid grid-cols-2 gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1"
        role="radiogroup"
        aria-label="Project type selector"
      >
        {PROJECT_TYPES.map((option) => (
          <button
            key={option.type}
            onClick={() => setProjectType(option.type)}
            role="radio"
            aria-checked={projectType === option.type}
            aria-label={`${option.name}: ${option.description}`}
            className={`
              flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] font-medium transition-all
              ${projectType === option.type
                ? 'bg-white/[0.1] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]'
                : 'text-[#737373] hover:bg-white/[0.04] hover:text-[#a1a1a1]'
              }
            `}
          >
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
                projectType === option.type
                  ? 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100'
                  : 'border-white/[0.06] bg-black/20 text-[#525252]'
              }`}
              aria-hidden="true"
            >
              {option.icon}
            </span>
            <span className="min-w-0">
              <span className="block truncate">{option.name}</span>
              <span className="block truncate text-[10px] font-normal text-[#6f6f6f]">{option.description}</span>
            </span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div 
      className="flex gap-3"
      role="radiogroup"
      aria-label="Choose project type"
    >
      {PROJECT_TYPES.map((option) => {
        const isSelected = projectType === option.type
        return (
          <motion.button
            key={option.type}
            onClick={() => setProjectType(option.type)}
            role="radio"
            aria-checked={isSelected}
            aria-label={`${option.name}: ${option.description}${isSelected ? '. Currently selected' : ''}`}
            className={`
              relative flex-1 flex items-center gap-3 p-4 rounded-xl border transition-all
              ${isSelected
                ? 'bg-[#c0c0c0]/5 border-[#c0c0c0]/40'
                : 'bg-[#0a0a0a] border-[#1f1f1f] hover:border-[#333]'
              }
            `}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            {/* Selection indicator */}
            {isSelected && (
              <motion.div
                className="absolute top-3 right-3 w-5 h-5 rounded-full bg-[#c0c0c0] flex items-center justify-center"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              >
                <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </motion.div>
            )}

            {/* Icon */}
            <div className={`
              w-12 h-12 rounded-xl flex items-center justify-center
              ${isSelected ? 'bg-[#c0c0c0]/10 text-[#c0c0c0]' : 'bg-[#1a1a1a] text-[#525252]'}
            `}>
              {option.icon}
            </div>

            {/* Text */}
            <div className="text-left">
              <div className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-[#a1a1a1]'}`}>
                {option.name}
              </div>
              <div className="text-[11px] text-[#525252]">
                {option.description}
              </div>
            </div>
          </motion.button>
        )
      })}
    </div>
  )
}
