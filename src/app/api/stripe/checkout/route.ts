/**
 * TORBIT - Stripe Checkout API
 *
 * Creates Stripe Checkout sessions for subscriptions and fuel purchases.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe, getSubscriptionPriceId, getFuelPackPriceId } from '@/lib/billing/stripe'
import type { CheckoutRequest, SubscriptionTier } from '@/lib/billing/types'
import { FUEL_PACKS, TIER_CONFIG } from '@/lib/billing/types'
import { withAuth } from '@/lib/middleware/auth'

export const POST = withAuth(async (request, { user }) => {
  try {
    const supabase = await createClient()

    // 1. Parse request
    const body: CheckoutRequest = await request.json()
    const { mode, tier, fuelPackId } = body

    // 2. Get or create Stripe customer
    const stripe = getStripe()
    let stripeCustomerId: string

    // Check if we have a Stripe customer for this user
    const { data: existingCustomer } = await supabase
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single()

    if (existingCustomer?.stripe_customer_id) {
      stripeCustomerId = existingCustomer.stripe_customer_id
    } else {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
        },
      })
      stripeCustomerId = customer.id

      // Save to database
      await supabase
        .from('stripe_customers')
        .insert({
          user_id: user.id,
          stripe_customer_id: customer.id,
        })
    }

    // 3. Build checkout session based on mode
    // Derive origin from the request URL (set by Next.js) instead of trusting
    // the Origin header, which can be spoofed by an attacker.
    const reqUrl = new URL(request.url)
    const origin = reqUrl.origin
    const successUrl = `${origin}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = `${origin}/dashboard?checkout=canceled`

    if (mode === 'subscription') {
      // Subscription checkout
      if (!tier || tier === 'free' || tier === 'enterprise') {
        return NextResponse.json(
          { success: false, error: 'Invalid subscription tier' },
          { status: 400 }
        )
      }

      const priceId = getSubscriptionPriceId(tier as 'pro' | 'team')
      if (!priceId) {
        console.error(`[checkout] Price ID not configured for subscription tier: ${tier}`)
        return NextResponse.json(
          { success: false, error: 'Checkout is not available at this time.' },
          { status: 500 }
        )
      }

      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: 'subscription',
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        subscription_data: {
          metadata: {
            supabase_user_id: user.id,
            tier: tier,
            fuel_allowance: String(TIER_CONFIG[tier as SubscriptionTier].fuelAllowance),
          },
        },
        metadata: {
          supabase_user_id: user.id,
          checkout_type: 'subscription',
          tier: tier,
        },
      })

      return NextResponse.json({
        success: true,
        sessionId: session.id,
        url: session.url || undefined,
      })

    } else if (mode === 'payment') {
      // One-time fuel pack purchase
      if (!fuelPackId) {
        return NextResponse.json(
          { success: false, error: 'Fuel pack ID required' },
          { status: 400 }
        )
      }

      const fuelPack = FUEL_PACKS.find(p => p.id === fuelPackId)
      if (!fuelPack) {
        return NextResponse.json(
          { success: false, error: 'Invalid fuel pack ID' },
          { status: 400 }
        )
      }

      const priceId = getFuelPackPriceId(fuelPackId)
      if (!priceId) {
        console.error(`[checkout] Price ID not configured for fuel pack: ${fuelPackId}`)
        return NextResponse.json(
          { success: false, error: 'Checkout is not available at this time.' },
          { status: 500 }
        )
      }

      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: 'payment',
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        payment_intent_data: {
          metadata: {
            supabase_user_id: user.id,
            checkout_type: 'fuel_purchase',
            fuel_pack_id: fuelPackId,
            fuel_amount: String(fuelPack.amount),
          },
        },
        metadata: {
          supabase_user_id: user.id,
          checkout_type: 'fuel_purchase',
          fuel_pack_id: fuelPackId,
          fuel_amount: String(fuelPack.amount),
        },
      })

      return NextResponse.json({
        success: true,
        sessionId: session.id,
        url: session.url || undefined,
      })
    }

    return NextResponse.json(
      { success: false, error: 'Invalid checkout mode' },
      { status: 400 }
    )

  } catch (error) {
    console.error('Checkout error:', error)
    return NextResponse.json(
      { success: false, error: 'Checkout failed. Please try again.' },
      { status: 500 }
    )
  }
})
