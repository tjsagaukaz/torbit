/**
 * TORBIT - Billing Utilities
 * 
 * Server-side utilities for fuel operations.
 * All functions require authenticated user context.
 */

import { createClient } from '@/lib/supabase/server'
import { error as logError } from '@/lib/observability/logger.server'
import type { 
  FuelBalance, 
  Subscription, 
  BillingTransaction,
  SubscriptionTier 
} from './types'
import { TIER_CONFIG } from './types'

/**
 * Get user's current fuel balance
 */
export async function getFuelBalance(userId: string): Promise<FuelBalance | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('fuel_balances')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error || !data) return null

  return {
    id: data.id,
    userId: data.user_id,
    currentFuel: data.current_fuel,
    lifetimeFuelPurchased: data.lifetime_fuel_purchased,
    lifetimeFuelUsed: data.lifetime_fuel_used,
    lastDailyRefillAt: data.last_daily_refill_at ? new Date(data.last_daily_refill_at) : null,
    lastMonthlyRefillAt: data.last_monthly_refill_at ? new Date(data.last_monthly_refill_at) : null,
    userTimezone: data.user_timezone || 'UTC',
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  }
}

/**
 * Get user's subscription details
 */
export async function getSubscription(userId: string): Promise<Subscription | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error || !data) return null

  return {
    id: data.id,
    userId: data.user_id,
    stripeSubscriptionId: data.stripe_subscription_id,
    stripePriceId: data.stripe_price_id,
    tier: data.tier as SubscriptionTier,
    status: data.status,
    monthlyFuelAllowance: data.monthly_fuel_allowance,
    currentPeriodStart: data.current_period_start ? new Date(data.current_period_start) : null,
    currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end) : null,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    trialEnd: data.trial_end ? new Date(data.trial_end) : null,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  }
}

/**
 * Get user's billing transactions
 */
export async function getBillingTransactions(
  userId: string,
  limit = 50
): Promise<BillingTransaction[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('billing_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data) return []

  return data.map(tx => ({
    id: tx.id,
    userId: tx.user_id,
    projectId: tx.project_id,
    type: tx.type,
    amount: tx.amount,
    balanceAfter: tx.balance_after,
    description: tx.description,
    stripePaymentIntentId: tx.stripe_payment_intent_id,
    stripeInvoiceId: tx.stripe_invoice_id,
    metadata: (tx.metadata && typeof tx.metadata === 'object' && !Array.isArray(tx.metadata) 
      ? tx.metadata 
      : {}) as Record<string, unknown>,
    createdAt: new Date(tx.created_at),
  }))
}

/**
 * Use fuel (deduct from balance)
 */
export async function useFuel(
  userId: string,
  projectId: string | null,
  amount: number,
  description: string,
  metadata: Record<string, unknown> = {}
): Promise<{ success: boolean; newBalance?: number; error?: string }> {
  const supabase = await createClient()
  
  const { data, error } = await supabase.rpc('use_fuel', {
    p_user_id: userId,
    p_project_id: projectId,
    p_amount: amount,
    p_description: description,
    p_metadata: metadata as unknown as import('@/lib/supabase/types').Json,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  // RPC returns table with success, new_balance, error_message
  const result = data?.[0]
  if (!result?.success) {
    return { 
      success: false, 
      newBalance: result?.new_balance,
      error: result?.error_message || 'Failed to deduct fuel' 
    }
  }

  return { success: true, newBalance: result.new_balance }
}

/**
 * Check if user can afford a fuel cost
 */
export async function canAfford(userId: string, amount: number): Promise<boolean> {
  const balance = await getFuelBalance(userId)
  return balance ? balance.currentFuel >= amount : false
}

/**
 * Check and process daily refill for free tier users
 */
export async function checkAndProcessDailyRefill(userId: string): Promise<{
  refilled: boolean
  amount?: number
  hoursUntilRefill?: number
}> {
  const supabase = await createClient()
  
  // Get subscription tier
  const subscription = await getSubscription(userId)
  
  // Only free tier gets daily refill
  if (!subscription || subscription.tier !== 'free') {
    return { refilled: false }
  }

  // Atomic refill path (preferred): check + refill in one DB function
  const refillAmount = TIER_CONFIG.free.fuelAllowance
  const { data: refillResult, error } = await supabase.rpc('process_daily_refill', {
    p_user_id: userId,
    p_refill_amount: refillAmount,
  })

  if (!error && refillResult?.[0]) {
    const row = refillResult[0]

    if (row.refilled) {
      return { refilled: true, amount: row.amount ?? refillAmount }
    }

    return {
      refilled: false,
      hoursUntilRefill: row.hours_until_refill ?? undefined,
    }
  }

  // Backward compatibility for environments that have not yet applied
  // the process_daily_refill function.
  const { data: eligibility, error: eligibilityError } = await supabase.rpc('check_daily_refill', {
    p_user_id: userId,
  })

  if (eligibilityError || !eligibility?.[0]) {
    if (error) {
      logError('billing.daily_refill_check_failed', {
        userId,
        message: error.message,
      })
    }
    return { refilled: false }
  }

  const { eligible, hours_until_refill } = eligibility[0]

  if (!eligible) {
    return { refilled: false, hoursUntilRefill: hours_until_refill }
  }

  const { error: refillError } = await supabase.rpc('add_fuel', {
    p_user_id: userId,
    p_amount: refillAmount,
    p_type: 'daily_refill',
    p_description: 'Daily free tier fuel refill',
    p_metadata: { tier: 'free' } as unknown as import('@/lib/supabase/types').Json,
  })

  if (refillError) {
    logError('billing.daily_refill_failed', {
      userId,
      message: refillError.message,
    })
    return { refilled: false }
  }

  return { refilled: true, amount: refillAmount }
}

/**
 * Update user's timezone (for daily refill calculations)
 */
export async function updateUserTimezone(
  userId: string, 
  timezone: string
): Promise<boolean> {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('fuel_balances')
    .update({ user_timezone: timezone })
    .eq('user_id', userId)

  return !error
}

/**
 * Get comprehensive billing status for a user
 */
export async function getBillingStatus(userId: string) {
  const [fuelBalance, subscription] = await Promise.all([
    getFuelBalance(userId),
    getSubscription(userId),
  ])

  const tier = subscription?.tier || 'free'
  const tierConfig = TIER_CONFIG[tier]

  // Calculate next refill
  let nextRefillAt: Date | null = null
  if (tier === 'free' && fuelBalance?.lastDailyRefillAt) {
    // Next midnight in user's timezone
    const lastRefill = new Date(fuelBalance.lastDailyRefillAt)
    nextRefillAt = new Date(lastRefill)
    nextRefillAt.setDate(nextRefillAt.getDate() + 1)
    nextRefillAt.setHours(0, 0, 0, 0)
  } else if (subscription?.currentPeriodEnd) {
    nextRefillAt = subscription.currentPeriodEnd
  }

  return {
    currentFuel: fuelBalance?.currentFuel || 0,
    tier,
    tierName: tierConfig.name,
    status: subscription?.status || 'active',
    fuelAllowance: tierConfig.fuelAllowance,
    refillPeriod: tierConfig.refillPeriod,
    nextRefillAt,
    canPurchaseFuel: tier !== 'free', // Free users must upgrade first
    lifetimePurchased: fuelBalance?.lifetimeFuelPurchased || 0,
    lifetimeUsed: fuelBalance?.lifetimeFuelUsed || 0,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd || false,
  }
}
