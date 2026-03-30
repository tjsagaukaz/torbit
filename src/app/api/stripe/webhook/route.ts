/**
 * TORBIT - Stripe Webhook Handler
 * 
 * Handles Stripe webhook events for subscriptions and payments.
 * 
 * Events handled:
 * - checkout.session.completed: Initial subscription or fuel purchase
 * - customer.subscription.created: New subscription activated
 * - customer.subscription.updated: Subscription changed (upgrade/downgrade)
 * - customer.subscription.deleted: Subscription canceled
 * - invoice.payment_succeeded: Monthly subscription renewal
 * - invoice.payment_failed: Payment failed
 */

import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import Stripe from 'stripe'
import { getStripe, verifyWebhookSignature } from '@/lib/billing/stripe'
import { createClient } from '@supabase/supabase-js'
import type { SubscriptionTier } from '@/lib/billing/types'
import { TIER_CONFIG } from '@/lib/billing/types'
import { isDuplicateStripeCreditError } from '@/lib/billing/idempotency'
import { stripeWebhookRateLimiter } from '@/lib/rate-limit'

// Use service role client for webhook (bypasses RLS)
function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase credentials not configured')
  }
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function addFuelSafely(
  supabase: ReturnType<typeof getAdminClient>,
  params: {
    p_user_id: string
    p_amount: number
    p_type: string
    p_description: string
    p_stripe_payment_intent_id?: string
    p_stripe_invoice_id?: string
    p_metadata?: Record<string, unknown>
  },
  duplicateContext: string
): Promise<void> {
  const { error } = await supabase.rpc('add_fuel', params)

  if (!error) return
  if (isDuplicateStripeCreditError(error)) {
    console.log(`Skipping duplicate Stripe credit (${duplicateContext})`)
    return
  }

  throw new Error(error.message || 'Failed to apply Stripe fuel credit')
}

async function reserveWebhookEvent(
  supabase: ReturnType<typeof getAdminClient>,
  event: Stripe.Event
): Promise<'process' | 'skip'> {
  const { data: existing, error: lookupError } = await supabase
    .from('stripe_webhook_events')
    .select('status, attempts')
    .eq('event_id', event.id)
    .maybeSingle()

  if (lookupError) {
    throw new Error(lookupError.message || 'Failed to check webhook idempotency')
  }

  if (existing) {
    if (existing.status === 'processed' || existing.status === 'processing') {
      return 'skip'
    }

    const nextAttempts = typeof existing.attempts === 'number' ? existing.attempts + 1 : 1
    const { error: updateError } = await supabase
      .from('stripe_webhook_events')
      .update({
        status: 'processing',
        attempts: nextAttempts,
        last_error: null,
      })
      .eq('event_id', event.id)

    if (updateError) {
      throw new Error(updateError.message || 'Failed to reserve webhook event')
    }

    return 'process'
  }

  const { error: insertError } = await supabase
    .from('stripe_webhook_events')
    .insert({
      event_id: event.id,
      event_type: event.type,
      status: 'processing',
      attempts: 1,
    })

  if (!insertError) return 'process'
  if (insertError.code === '23505') return 'skip'

  throw new Error(insertError.message || 'Failed to store webhook event')
}

async function markWebhookEventProcessed(
  supabase: ReturnType<typeof getAdminClient>,
  event: Stripe.Event
): Promise<void> {
  const { error } = await supabase
    .from('stripe_webhook_events')
    .update({
      status: 'processed',
      processed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('event_id', event.id)

  if (error) {
    throw new Error(error.message || 'Failed to mark webhook event as processed')
  }
}

async function markWebhookEventFailed(
  supabase: ReturnType<typeof getAdminClient>,
  event: Stripe.Event,
  cause: unknown
): Promise<void> {
  const lastError = cause instanceof Error ? cause.message : 'Unknown webhook failure'
  const { error } = await supabase
    .from('stripe_webhook_events')
    .update({
      status: 'failed',
      last_error: lastError.slice(0, 500),
    })
    .eq('event_id', event.id)

  if (error) {
    console.error('Failed to mark webhook event as failed:', error)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Get raw body for signature verification
    const body = await request.text()
    const headersList = await headers()
    const signature = headersList.get('stripe-signature')

    if (!signature) {
      console.error('Missing stripe-signature header')
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 400 }
      )
    }

    // 2. Verify webhook signature
    let event: Stripe.Event
    try {
      event = verifyWebhookSignature(body, signature)
    } catch (err) {
      console.error('Webhook signature verification failed:', err)
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 400 }
      )
    }

    // 3. Per-customer rate limit — guards against abuse if the webhook secret leaks.
    const customerId = extractCustomerId(event)
    if (customerId) {
      const rl = await stripeWebhookRateLimiter.check(`customer:${customerId}`)
      if (!rl.success) {
        console.warn('[webhook] rate limit hit for customer', customerId.slice(0, 12))
        return NextResponse.json({ received: true, rateLimited: true })
      }
    }

    // 4. Handle the event
    const supabase = getAdminClient()
    const reservation = await reserveWebhookEvent(supabase, event)
    if (reservation === 'skip') {
      return NextResponse.json({ received: true, duplicate: true })
    }

    try {
      switch (event.type) {
        // ====================================
        // CHECKOUT COMPLETED
        // ====================================
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session
          const metadata = session.metadata || {}
          const userId = metadata.supabase_user_id

          if (!userId) {
            console.error('Missing supabase_user_id in checkout session metadata')
            break
          }

          if (metadata.checkout_type === 'fuel_purchase') {
            // One-time fuel purchase
            const fuelAmount = parseInt(metadata.fuel_amount || '0', 10)
            
            if (fuelAmount > 0) {
              await addFuelSafely(supabase, {
                p_user_id: userId,
                p_amount: fuelAmount,
                p_type: 'purchase',
                p_description: `Fuel pack: ${metadata.fuel_pack_id}`,
                p_stripe_payment_intent_id: session.payment_intent as string,
                p_metadata: { fuel_pack_id: metadata.fuel_pack_id },
              }, `payment_intent:${session.payment_intent as string}`)

              console.log(`Added ${fuelAmount} fuel to user ${userId.slice(0, 8)}...`)
            }
          }
          // Subscription checkout is handled by customer.subscription.created
          break
        }

        // ====================================
        // SUBSCRIPTION CREATED
        // ====================================
        case 'customer.subscription.created': {
          const subscription = event.data.object as Stripe.Subscription
          const metadata = subscription.metadata || {}
          const userId = metadata.supabase_user_id
          const tier = (metadata.tier || 'pro') as SubscriptionTier

          if (!userId) {
            // Try to get from customer
            const stripe = getStripe()
            const customer = await stripe.customers.retrieve(subscription.customer as string)
            if (customer.deleted) break
            
            const { data: customerRecord } = await supabase
              .from('stripe_customers')
              .select('user_id')
              .eq('stripe_customer_id', subscription.customer)
              .single()
            
            if (!customerRecord) {
              console.error('Could not find user for subscription')
              break
            }
            
            await handleSubscriptionCreated(supabase, customerRecord.user_id, subscription, tier)
          } else {
            await handleSubscriptionCreated(supabase, userId, subscription, tier)
          }
          break
        }

        // ====================================
        // SUBSCRIPTION UPDATED
        // ====================================
        case 'customer.subscription.updated': {
          const subscription = event.data.object as Stripe.Subscription
          
          // Get user from customer
          const { data: customerRecord } = await supabase
            .from('stripe_customers')
            .select('user_id')
            .eq('stripe_customer_id', subscription.customer)
            .single()
          
          if (!customerRecord) break

          const status = mapStripeStatus(subscription.status)
          const tier = subscription.metadata?.tier as SubscriptionTier || 'pro'

          // Get period dates from the first subscription item (new Stripe API)
          const firstItem = subscription.items.data[0]
          const currentPeriodStart = firstItem?.current_period_start
          const currentPeriodEnd = firstItem?.current_period_end

          await supabase
            .from('subscriptions')
            .update({
              status,
              tier,
              stripe_price_id: firstItem?.price.id,
              current_period_start: currentPeriodStart 
                ? new Date(currentPeriodStart * 1000).toISOString() 
                : undefined,
              current_period_end: currentPeriodEnd 
                ? new Date(currentPeriodEnd * 1000).toISOString() 
                : undefined,
              cancel_at_period_end: subscription.cancel_at_period_end,
              monthly_fuel_allowance: TIER_CONFIG[tier].fuelAllowance,
            })
            .eq('user_id', customerRecord.user_id)

          console.log(`Updated subscription for user ${customerRecord.user_id.slice(0, 8)}... to ${tier}`)
          break
        }

        // ====================================
        // SUBSCRIPTION DELETED
        // ====================================
        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription

          const { data: customerRecord } = await supabase
            .from('stripe_customers')
            .select('user_id')
            .eq('stripe_customer_id', subscription.customer)
            .single()
          
          if (!customerRecord) break

          // Downgrade to free tier
          await supabase
            .from('subscriptions')
            .update({
              status: 'canceled',
              tier: 'free',
              monthly_fuel_allowance: TIER_CONFIG.free.fuelAllowance,
              stripe_subscription_id: null,
              stripe_price_id: null,
            })
            .eq('user_id', customerRecord.user_id)

          console.log(`Subscription canceled for user ${customerRecord.user_id.slice(0, 8)}..., downgraded to free`)
          break
        }

        // ====================================
        // INVOICE PAYMENT SUCCEEDED (Monthly renewal)
        // ====================================
        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as Stripe.Invoice
          
          // Skip if not a subscription invoice (new Stripe API uses parent.subscription_details)
          const subscriptionId = invoice.parent?.subscription_details?.subscription
          if (!subscriptionId) break

          const { data: customerRecord } = await supabase
            .from('stripe_customers')
            .select('user_id')
            .eq('stripe_customer_id', invoice.customer)
            .single()
          
          if (!customerRecord) break

          // Get user's subscription tier
          const { data: subscription } = await supabase
            .from('subscriptions')
            .select('tier')
            .eq('user_id', customerRecord.user_id)
            .single()
          
          if (!subscription) break

          const tier = subscription.tier as SubscriptionTier
          const fuelAmount = TIER_CONFIG[tier].fuelAllowance

          // Refill fuel for the new period
          await addFuelSafely(supabase, {
            p_user_id: customerRecord.user_id,
            p_amount: fuelAmount,
            p_type: 'subscription_refill',
            p_description: `Monthly ${tier} subscription refill`,
            p_stripe_invoice_id: invoice.id,
            p_metadata: { tier, period: invoice.period_end },
          }, `invoice:${invoice.id}`)

          console.log(`Monthly refill: ${fuelAmount} fuel for user ${customerRecord.user_id.slice(0, 8)}...`)
          break
        }

        // ====================================
        // INVOICE PAYMENT FAILED
        // ====================================
        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice
          
          // Skip if not a subscription invoice (new Stripe API uses parent.subscription_details)
          const subscriptionId = invoice.parent?.subscription_details?.subscription
          if (!subscriptionId) break

          const { data: customerRecord } = await supabase
            .from('stripe_customers')
            .select('user_id')
            .eq('stripe_customer_id', invoice.customer)
            .single()
          
          if (!customerRecord) break

          // Mark subscription as past_due
          await supabase
            .from('subscriptions')
            .update({ status: 'past_due' })
            .eq('user_id', customerRecord.user_id)

          console.log(`Payment failed for user ${customerRecord.user_id.slice(0, 8)}...`)
          // TODO: Send email notification to user
          break
        }

        default:
          console.log(`Unhandled event type: ${event.type}`)
      }
    } catch (processingError) {
      await markWebhookEventFailed(supabase, event, processingError)
      throw processingError
    }

    await markWebhookEventProcessed(supabase, event)
    return NextResponse.json({ received: true })

  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    )
  }
}

// Helper functions

function extractCustomerId(event: Stripe.Event): string | null {
  const obj = event.data.object as unknown as Record<string, unknown>
  if (typeof obj.customer === 'string') return obj.customer
  return null
}

async function handleSubscriptionCreated(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  subscription: Stripe.Subscription,
  tier: SubscriptionTier
) {
  const fuelAllowance = TIER_CONFIG[tier].fuelAllowance
  
  // Get period dates from the first subscription item (new Stripe API)
  const firstItem = subscription.items.data[0]
  const currentPeriodStart = firstItem?.current_period_start
  const currentPeriodEnd = firstItem?.current_period_end

  // Update or create subscription record
  await supabase
    .from('subscriptions')
    .upsert({
      user_id: userId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: firstItem?.price.id,
      tier,
      status: mapStripeStatus(subscription.status),
      monthly_fuel_allowance: fuelAllowance,
      current_period_start: currentPeriodStart 
        ? new Date(currentPeriodStart * 1000).toISOString()
        : new Date().toISOString(),
      current_period_end: currentPeriodEnd 
        ? new Date(currentPeriodEnd * 1000).toISOString()
        : new Date().toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      trial_end: subscription.trial_end 
        ? new Date(subscription.trial_end * 1000).toISOString() 
        : null,
    }, {
      onConflict: 'user_id',
    })

  // Add initial fuel allocation
  await addFuelSafely(supabase, {
    p_user_id: userId,
    p_amount: fuelAllowance,
    p_type: 'subscription_refill',
    p_description: `Initial ${tier} subscription activation`,
    p_metadata: { tier, subscription_id: subscription.id },
  }, `subscription:${subscription.id}`)

  console.log(`Created ${tier} subscription for user ${userId.slice(0, 8)}... with ${fuelAllowance} fuel`)
}

function mapStripeStatus(status: Stripe.Subscription.Status): string {
  const statusMap: Record<Stripe.Subscription.Status, string> = {
    active: 'active',
    canceled: 'canceled',
    incomplete: 'incomplete',
    incomplete_expired: 'canceled',
    past_due: 'past_due',
    paused: 'canceled',
    trialing: 'trialing',
    unpaid: 'past_due',
  }
  return statusMap[status] || 'active'
}
