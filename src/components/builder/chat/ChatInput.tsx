'use client'

import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

interface ChatInputProps {
  input: string
  isLoading: boolean
  onInputChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  intentMode: 'auto' | 'chat' | 'action'
  onIntentModeChange: (mode: 'auto' | 'chat' | 'action') => void
  currentStep?: number
  hasMessages?: boolean
}

const QUICK_PROMPTS = [
  'Build a premium SaaS dashboard for revenue operations with real-seeming metrics, rich empty states, and a distinct motion language.',
  'Design a launch landing page with a strong visual point of view, a clear narrative arc, pricing, FAQ, and high-conv CTAs.',
  'Create a serious internal ops console with dense but legible workflows, audit history, bulk actions, and safe failure handling.',
  'Build an Expo mobile product with native-feeling navigation, onboarding, account settings, and polished loading and error states.',
]

const QUALITY_INSERTS = [
  'Include empty, loading, and error states.',
  'Give it a distinct visual system, not a template look.',
  'Use realistic seeded data and believable workflows.',
  'Bias for production-safe architecture and validation.',
]

export function ChatInput({
  input,
  isLoading,
  onInputChange,
  onSubmit,
  intentMode,
  onIntentModeChange,
  hasMessages = false,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`
    }
  }, [input])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const focusInput = () => textareaRef.current?.focus()
    window.addEventListener('torbit-focus-chat-input', focusInput)
    return () => window.removeEventListener('torbit-focus-chat-input', focusInput)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit(e as unknown as React.FormEvent)
    }
  }

  const insertText = (value: string) => {
    const nextValue = input.trim()
      ? `${input.trim()} ${value}`
      : value
    onInputChange(nextValue)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="border-t border-[#151515] bg-[#000000] p-3"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2" role="radiogroup" aria-label="Prompt mode">
        <div className="flex flex-wrap items-center gap-2">
          {([
            { value: 'auto', label: 'Architected', hint: 'Torbit plans and routes the work' },
            { value: 'chat', label: 'Refine', hint: 'Keep this as conversation and critique' },
            { value: 'action', label: 'Direct Build', hint: 'Skip discussion and produce immediately' },
          ] as const).map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={intentMode === mode.value}
              title={mode.hint}
              disabled={isLoading}
              onClick={() => onIntentModeChange(mode.value)}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                intentMode === mode.value
                  ? 'border-white/[0.14] bg-white/[0.1] text-[#f5f5f5]'
                  : 'border-white/[0.08] bg-white/[0.03] text-[#7a7a7a] hover:border-white/[0.14] hover:text-[#c3c3c3]'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-[#696969]">
          {isLoading ? 'Torbit is executing the current run' : 'Outcome + audience + differentiator + feel'}
        </span>
      </div>

      {!hasMessages && !input.trim() && (
        <div className="mb-3 space-y-2.5">
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#737373]">Mission Starters</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={isLoading}
                  onClick={() => insertText(prompt)}
                  className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-left text-[10px] text-[#9a9a9a] transition-colors hover:border-white/[0.16] hover:text-[#d8d8d8] disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#737373]">Quality Lenses</p>
            <div className="flex flex-wrap gap-1.5">
              {QUALITY_INSERTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={isLoading}
                  onClick={() => insertText(prompt)}
                  className="rounded-full border border-cyan-300/10 bg-cyan-300/[0.08] px-3 py-1.5 text-left text-[10px] text-cyan-100/70 transition-colors hover:border-cyan-200/20 hover:text-cyan-50 disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="relative">
        <div className="overflow-hidden rounded-[22px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] shadow-[0_18px_60px_rgba(0,0,0,0.35)] transition-all focus-within:border-white/[0.16]">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#7d7d7d]">Torbit Build Brief</p>
              <p className="mt-1 text-[11px] text-[#a8a8a8]">
                Ask for the product, the quality bar, and the emotional tone.
              </p>
            </div>
            <div className="hidden rounded-full border border-white/[0.08] bg-black/20 px-2.5 py-1 text-[10px] text-[#6d6d6d] sm:block">
              Enter send
            </div>
          </div>

          <div className="relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hasMessages
                ? 'Push the next iteration: what should change, tighten, or elevate?'
                : 'Describe what Torbit should build, who it serves, what makes it different, and how it should feel.'}
              aria-label="Describe what you want Torbit to produce"
              disabled={isLoading}
              rows={1}
              className="w-full resize-none bg-transparent px-4 py-4 pr-14 text-[14px] leading-relaxed text-[#ffffff] outline-none placeholder:text-[#4f4f4f] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ minHeight: '110px', maxHeight: '220px' }}
            />

            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="absolute right-3 bottom-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#d7d7d7] text-[#000000] transition-all hover:bg-[#f0f0f0] disabled:cursor-not-allowed disabled:bg-[#181818] disabled:text-[#4a4a4a]"
              aria-label="Submit build brief"
            >
              {isLoading ? (
                <motion.div
                  className="h-4 w-4 rounded-full border-2 border-[#525252] border-t-[#0a0a0a]"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                />
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </form>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[#6f6f6f]">
        <span className="rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1">State the user</span>
        <span className="rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1">Name the core workflow</span>
        <span className="rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1">Call out edge states</span>
        <span className="rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1">Set the visual direction</span>
      </div>
    </motion.div>
  )
}
