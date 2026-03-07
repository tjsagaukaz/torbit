'use client'

import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFuelStore } from '@/store/fuel'
import { TorbitSpinner } from '@/components/ui/TorbitLogo'
import { useEscapeToClose } from '@/hooks/useEscapeToClose'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { error as logError } from '@/lib/observability/logger.client'

/**
 * RefuelModal - The "Refueling Station"
 * 
 * Arcade-style fuel pack purchases with "Insert Coin to Continue" psychology.
 * One-time purchases for the "Tourist" market who don't want subscriptions.
 * 
 * Fuel Packs:
 * - Emergency Rod (500) - $9: Quick fixes
 * - Jerry Can (2,500) - $29: Feature builds  
 * - Reactor Core (10,000) - $99: Full MVP
 */

interface FuelPack {
  id: string
  name: string
  amount: number
  price: number
  desc: string
  color: string
  bgColor: string
  borderColor: string
  buttonColor: string
  popular?: boolean
}

const FUEL_PACKS: FuelPack[] = [
  {
    id: 'emergency',
    name: 'Emergency Rod',
    amount: 500,
    price: 9,
    desc: 'Quick fixes & patches',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30 hover:border-amber-400/60',
    buttonColor: 'bg-amber-500 hover:bg-amber-400',
  },
  {
    id: 'canister',
    name: 'Jerry Can',
    amount: 2500,
    price: 29,
    desc: 'Feature build & refactor',
    color: 'text-[#c0c0c0]',
    bgColor: 'bg-[#c0c0c0]/10',
    borderColor: 'border-[#c0c0c0]/30 hover:border-[#c0c0c0]/60',
    buttonColor: 'bg-[#c0c0c0] hover:bg-[#d0d0d0] text-black',
    popular: true,
  },
  {
    id: 'core',
    name: 'Reactor Core',
    amount: 10000,
    price: 99,
    desc: 'Full MVP development',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30 hover:border-purple-400/60',
    buttonColor: 'bg-purple-500 hover:bg-purple-400',
  },
]

interface RefuelModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function RefuelModal({ open, onOpenChange }: RefuelModalProps) {
  const { topUp, currentFuel, maxFuel, getFuelStatus } = useFuelStore()
  const [selectedPack, setSelectedPack] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [purchasedAmount, setPurchasedAmount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  const status = getFuelStatus()
  const isCritical = status === 'critical'
  const closeModal = () => {
    if (!isProcessing) onOpenChange(false)
  }

  useEscapeToClose(open, closeModal)
  useBodyScrollLock(open)
  useFocusTrap(modalRef, open)

  const handlePurchase = async (pack: FuelPack) => {
    setSelectedPack(pack.id)
    setIsProcessing(true)
    setError(null)

    try {
      // Check if Stripe is configured
      if (!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
        // Fallback to demo mode if Stripe not configured
        await new Promise(resolve => setTimeout(resolve, 1500))
        topUp(pack.amount)
        setPurchasedAmount(pack.amount)
        setShowSuccess(true)
        setTimeout(() => {
          setShowSuccess(false)
          setSelectedPack(null)
          onOpenChange(false)
        }, 2000)
        return
      }

      // Create Stripe Checkout session
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'payment',
          fuelPackId: pack.id,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to create checkout session')
      }

      // Redirect to Stripe Checkout
      // Modern Stripe.js uses direct URL redirect from the session
      if (data.url) {
        window.location.href = data.url
      } else if (data.sessionId) {
        // Legacy fallback - manually construct checkout URL
        window.location.href = `https://checkout.stripe.com/pay/${data.sessionId}`
      }
    } catch (err) {
      logError('builder.refuel.purchase_failed', {
        packId: pack.id,
        message: err instanceof Error ? err.message : 'Purchase failed',
      })
      setError(err instanceof Error ? err.message : 'Purchase failed')
      setIsProcessing(false)
      setSelectedPack(null)
    }
  }


  if (!open) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={closeModal}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          ref={modalRef}
          className="relative bg-neutral-900/95 border border-neutral-700/50 rounded-2xl p-6 max-w-3xl w-full mx-4 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="refuel-modal-title"
        >
          {/* Success Overlay */}
          <AnimatePresence>
            {showSuccess && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-neutral-900/98 rounded-2xl"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: [0, 1.2, 1] }}
                  transition={{ duration: 0.5 }}
                  className="w-20 h-20 rounded-full bg-[#c0c0c0]/20 flex items-center justify-center mb-4"
                >
                  <svg className="w-10 h-10 text-[#c0c0c0]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </motion.div>
                <motion.h3
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="text-2xl font-bold text-[#c0c0c0] mb-2"
                >
                  REACTOR RECHARGED
                </motion.h3>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="text-neutral-400"
                >
                  +{purchasedAmount.toLocaleString()} fuel units injected
                </motion.p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              {/* Warning icon for critical status */}
              {isCritical && (
                <motion.div
                  animate={{ scale: [1, 1.1, 1], opacity: [1, 0.7, 1] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                  className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center"
                >
                  <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </motion.div>
              )}
              <div>
                <h2
                  id="refuel-modal-title"
                  className={`text-xl font-bold ${isCritical ? 'text-red-400' : 'text-neutral-100'}`}
                >
                  {isCritical ? 'EMERGENCY REFUEL REQUIRED' : 'REFUELING STATION'}
                </h2>
                <p className="text-sm text-neutral-500">
                  Select fuel quantity • No subscription required
                </p>
              </div>
            </div>

            {/* Close button */}
            <button
              onClick={() => onOpenChange(false)}
              disabled={isProcessing}
              aria-label="Close refuel dialog"
              className="w-8 h-8 flex items-center justify-center text-neutral-500 hover:text-neutral-300 transition-colors rounded-lg hover:bg-neutral-800 disabled:opacity-50"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Current Fuel Status */}
          <div className="mb-6 p-3 bg-neutral-800/50 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${
                status === 'critical' ? 'bg-red-500 animate-pulse' :
                status === 'low' ? 'bg-amber-500' :
                'bg-[#c0c0c0]'
              }`} />
              <span className="text-sm text-neutral-400">Current Fuel:</span>
              <span className={`text-sm font-bold ${
                status === 'critical' ? 'text-red-400' :
                status === 'low' ? 'text-amber-400' :
                'text-neutral-200'
              }`}>
                {currentFuel.toLocaleString()} / {maxFuel.toLocaleString()}
              </span>
            </div>
            <span className="text-xs text-neutral-500">
              {Math.round((currentFuel / maxFuel) * 100)}% capacity
            </span>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Fuel Pack Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {FUEL_PACKS.map((pack) => {
              const isSelected = selectedPack === pack.id
              
              return (
                <motion.button
                  key={pack.id}
                  onClick={() => !isProcessing && handlePurchase(pack)}
                  disabled={isProcessing}
                  whileHover={{ scale: isProcessing ? 1 : 1.02 }}
                  whileTap={{ scale: isProcessing ? 1 : 0.98 }}
                  className={`
                    relative flex flex-col items-center p-5 rounded-xl border-2 transition-all duration-300
                    ${pack.borderColor}
                    ${isSelected && isProcessing ? pack.bgColor : 'hover:bg-white/5'}
                    ${isProcessing && !isSelected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  {/* Popular Badge */}
                  {pack.popular && (
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-[#c0c0c0] text-black text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                      Best Value
                    </div>
                  )}

                  {/* Processing Spinner */}
                  {isSelected && isProcessing && (
                    <motion.div
                      className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl backdrop-blur-sm"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <TorbitSpinner size="lg" speed="fast" />
                    </motion.div>
                  )}

                  {/* Icon */}
                  <div className={`mb-3 p-3 rounded-xl ${pack.bgColor}`}>
                    {pack.id === 'emergency' && (
                      <svg className={`w-8 h-8 ${pack.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h2V5H5a2 2 0 00-2 2zm6-2v14h6V5H9zm8 14h2a2 2 0 002-2V7a2 2 0 00-2-2h-2v14z" />
                      </svg>
                    )}
                    {pack.id === 'canister' && (
                      <svg className={`w-8 h-8 ${pack.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    )}
                    {pack.id === 'core' && (
                      <svg className={`w-8 h-8 ${pack.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    )}
                  </div>

                  {/* Pack Name */}
                  <h3 className={`text-sm font-bold uppercase tracking-wide ${pack.color} mb-1`}>
                    {pack.name}
                  </h3>

                  {/* Fuel Amount */}
                  <div className="text-2xl font-bold text-neutral-100 mb-1">
                    {pack.amount.toLocaleString()}
                    <span className="text-xs text-neutral-500 font-normal ml-1">UNITS</span>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-neutral-500 mb-4">{pack.desc}</p>

                  {/* Price Button */}
                  <div className={`w-full py-2 rounded-lg ${pack.buttonColor} text-black font-bold text-sm flex items-center justify-center gap-1 transition-colors`}>
                    <span>${pack.price}</span>
                    <span className="opacity-60 text-[10px]">USD</span>
                  </div>
                </motion.button>
              )
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between text-xs text-neutral-500 pt-4 border-t border-neutral-800">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="text-blue-400">Auditor Guarantee included</span>
            </div>
            <span>Secure payment via Stripe</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
