/**
 * TORBIT - Billing Status API
 * 
 * Returns user's current billing status including fuel balance,
 * subscription tier, and next refill time.
 */

import { NextResponse } from 'next/server'
import { getBillingStatus, checkAndProcessDailyRefill } from '@/lib/billing/utils'
import { withAuth } from '@/lib/middleware/auth'
import { error as logError } from '@/lib/observability/logger.server'

export const GET = withAuth(async (_req, { user }) => {
  try {
    // 1. Check for daily refill eligibility (free tier)
    const refillResult = await checkAndProcessDailyRefill(user.id)

    // 3. Get full billing status
    const status = await getBillingStatus(user.id)

    return NextResponse.json({
      success: true,
      ...status,
      dailyRefill: refillResult.refilled ? {
        refilled: true,
        amount: refillResult.amount,
      } : refillResult.hoursUntilRefill ? {
        refilled: false,
        hoursUntilRefill: refillResult.hoursUntilRefill,
      } : null,
    })

  } catch (error) {
    logError('billing.status_route_failed', {
      userId: user.id,
      message: error instanceof Error ? error.message : 'Failed to get billing status',
    })
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get billing status'
      },
      { status: 500 }
    )
  }
})
