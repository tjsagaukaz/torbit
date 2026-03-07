'use client'

import { motion } from 'framer-motion'
import { detectBrowser } from '@/lib/browser-detect'

/**
 * Safari Fallback Mode
 * 
 * Honest, authoritative gate for browsers that don't support WebContainers.
 * Safari users can still:
 * - Generate code
 * - Review generated files
 * - Export verified projects
 * 
 * What they don't get:
 * - Live runtime preview
 * - Dev server
 * - Terminal output
 */
export function SafariFallback({ 
  onContinue 
}: { 
  onContinue?: () => void 
}) {
  const browser = detectBrowser()

  const handleOpenChrome = () => {
    // Copy current URL to clipboard for easy paste
    navigator.clipboard?.writeText(window.location.href)
    window.open('https://www.google.com/chrome/', '_blank')
  }

  return (
    <div className="h-full flex items-center justify-center bg-[#050505] p-8">
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="max-w-md text-center"
      >
        {/* Icon */}
        <div className="mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#0a0a0a] border border-[#1a1a1a]">
            <svg 
              className="w-8 h-8 text-[#525252]" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor" 
              strokeWidth={1.5}
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" 
              />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-xl font-semibold text-white mb-3">
          Live execution unavailable
        </h2>

        {/* Explanation */}
        <p className="text-[14px] text-[#808080] leading-relaxed mb-6">
          TORBIT uses a secure execution environment that requires Chrome or Edge.
          {browser.isSafari && ' Safari does not support the required browser APIs.'}
        </p>

        {/* What you can still do */}
        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 mb-6 text-left">
          <p className="text-[12px] text-[#525252] uppercase tracking-wider mb-3">
            You can still:
          </p>
          <ul className="space-y-2">
            <li className="flex items-center gap-2.5 text-[13px] text-[#a0a0a0]">
              <svg className="w-4 h-4 text-emerald-500/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Design and generate code
            </li>
            <li className="flex items-center gap-2.5 text-[13px] text-[#a0a0a0]">
              <svg className="w-4 h-4 text-emerald-500/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Review generated files
            </li>
            <li className="flex items-center gap-2.5 text-[13px] text-[#a0a0a0]">
              <svg className="w-4 h-4 text-emerald-500/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Export verified projects
            </li>
          </ul>
        </div>

        {/* Note */}
        <p className="text-[12px] text-[#525252] mb-6">
          Execution occurs after export when you run locally or deploy.
        </p>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <button
            onClick={handleOpenChrome}
            className="w-full px-4 py-2.5 bg-white text-black text-[13px] font-medium rounded-lg hover:bg-neutral-200 transition-colors"
          >
            Open in Chrome
          </button>
          
          {onContinue && (
            <button
              onClick={onContinue}
              className="w-full px-4 py-2.5 bg-[#0a0a0a] border border-[#1a1a1a] text-[#808080] text-[13px] font-medium rounded-lg hover:border-[#2a2a2a] hover:text-white transition-all"
            >
              Continue without live execution
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

/**
 * Compact Safari notice banner for the preview area
 */
export function SafariBanner({ onDismiss }: { onDismiss?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-center justify-between gap-4 px-4 py-2.5 bg-[#0a0a0a] border-b border-[#1a1a1a]"
    >
      <div className="flex items-center gap-2">
        <svg 
          className="w-4 h-4 text-amber-500/70" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor" 
          strokeWidth={2}
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" 
          />
        </svg>
        <span className="text-[12px] text-[#808080]">
          Live preview unavailable in this browser. 
          <span className="text-[#a0a0a0]"> Code generation works normally.</span>
        </span>
      </div>
      
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-[#525252] hover:text-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </motion.div>
  )
}
