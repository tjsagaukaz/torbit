'use client'

import { memo } from 'react'
import { motion } from 'framer-motion'
import { StreamingMessage } from './StreamingMessage'
import type { Message } from './types'

interface MessageBubbleProps {
  message: Message
  isLast: boolean
  isLoading: boolean
  index: number
  onRetry?: () => void
}

/**
 * MessageBubble - Routes to user or agent message style
 */
export const MessageBubble = memo(function MessageBubble({ message, isLast, isLoading, onRetry }: MessageBubbleProps) {
  // User message - Right-aligned minimal pill
  if (message.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="py-3 flex justify-end"
      >
        <div className="max-w-[85%] px-4 py-2.5 rounded-2xl bg-[#1a1a1a]">
          <p className="text-[14px] text-[#e5e5e5] leading-relaxed whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
      </motion.div>
    )
  }

  // Assistant message - Enhanced streaming experience
  return (
    <StreamingMessage
      message={message}
      isLast={isLast}
      isLoading={isLoading}
      onRetry={onRetry}
    />
  )
})
