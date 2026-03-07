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
  'Build a polished SaaS dashboard for a small business with onboarding, a dashboard, settings, and realistic sample data.',
  'Create a landing page for a new product with clear sections, pricing, FAQ, and strong call-to-action buttons.',
  'Build a mobile app with onboarding, navigation, account settings, and good loading and error states.',
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
            { value: 'auto', label: 'Guide build', hint: 'Torbit plans the work as it goes' },
            { value: 'chat', label: 'Talk it through', hint: 'Keep this as a back-and-forth conversation' },
            { value: 'action', label: 'Build now', hint: 'Skip the discussion and start building' },
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
          {isLoading ? 'Torbit is building your request' : 'Be clear about the product, user, and style'}
        </span>
      </div>

      {!hasMessages && !input.trim() && (
        <div className="mb-3">
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#737373]">Try one of these</p>
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
        </div>
      )}

      <form onSubmit={onSubmit} className="relative">
        <div className="overflow-hidden rounded-[22px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] shadow-[0_18px_60px_rgba(0,0,0,0.35)] transition-all focus-within:border-white/[0.16]">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#7d7d7d]">Start here</p>
              <p className="mt-1 text-[11px] text-[#a8a8a8]">
                Describe the product, who it is for, and how it should feel.
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
                ? 'What should change next?'
                : 'What should Torbit build? Describe the product, who it is for, and the style you want.'}
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

      <p className="mt-2.5 text-[10px] text-[#6f6f6f]">
        Tip: mention the user, the main workflow, and the visual style you want.
      </p>
    </motion.div>
  )
}
