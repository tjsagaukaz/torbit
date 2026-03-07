/**
 * TORBIT - Stripe Customer Portal API
 *
 * Creates a session for the Stripe Customer Portal where users can:
 * - Update payment method
 * - View invoices
 * - Cancel/modify subscription
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/billing/stripe'
import { withAuth } from '@/lib/middleware/auth'

export const POST = withAuth(async (request, { user }) => {
  try {
    const supabase = await createClient()

    // 1. Get Stripe customer ID
    const { data: customerRecord } = await supabase
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single()

    if (!customerRecord?.stripe_customer_id) {
      return NextResponse.json(
        { success: false, error: 'No billing account found. Subscribe first.' },
        { status: 400 }
      )
    }

    // 2. Create portal session
    const stripe = getStripe()
    // Derive origin from the request URL (set by Next.js) instead of trusting
    // the Origin header, which can be spoofed by an attacker.
    const origin = new URL(request.url).origin

    const session = await stripe.billingPortal.sessions.create({
      customer: customerRecord.stripe_customer_id,
      return_url: `${origin}/dashboard`,
    })

    return NextResponse.json({
      success: true,
      url: session.url,
    })

  } catch (error) {
    console.error('Portal error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create portal session'
      },
      { status: 500 }
    )
  }
})
