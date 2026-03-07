import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@/lib/supabase/server'
import {
  checkAndProcessDailyRefill,
  getBillingStatus,
  getFuelBalance,
  useFuel,
} from './utils'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/observability/logger.server', () => ({
  error: vi.fn(),
}))

function createSelectQuery(singleResult: unknown, listResult?: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  }

  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.order.mockReturnValue(query)
  query.single.mockResolvedValue(singleResult)
  query.limit.mockResolvedValue(listResult ?? singleResult)

  return query
}

describe('billing utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps the persisted fuel balance into the domain model', async () => {
    const fuelBalanceQuery = createSelectQuery({
      data: {
        id: 'fuel-balance-1',
        user_id: 'user-1',
        current_fuel: 320,
        lifetime_fuel_purchased: 1200,
        lifetime_fuel_used: 880,
        last_daily_refill_at: '2026-03-06T00:00:00.000Z',
        last_monthly_refill_at: null,
        user_timezone: 'America/New_York',
        created_at: '2026-03-01T12:00:00.000Z',
        updated_at: '2026-03-06T12:00:00.000Z',
      },
      error: null,
    })

    vi.mocked(createClient).mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'fuel_balances') return fuelBalanceQuery
        throw new Error(`Unexpected table ${table}`)
      }),
    } as never)

    const balance = await getFuelBalance('user-1')

    expect(balance).toMatchObject({
      id: 'fuel-balance-1',
      userId: 'user-1',
      currentFuel: 320,
      userTimezone: 'America/New_York',
    })
    expect(balance?.lastDailyRefillAt).toBeInstanceOf(Date)
    expect(balance?.updatedAt).toBeInstanceOf(Date)
  })

  it('returns the new balance from the use_fuel rpc', async () => {
    vi.mocked(createClient).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: [{ success: true, new_balance: 91 }],
        error: null,
      }),
    } as never)

    await expect(
      useFuel('user-2', 'project-9', 9, 'Run builder', { intent: 'build' })
    ).resolves.toEqual({
      success: true,
      newBalance: 91,
    })
  })

  it('uses the atomic daily refill rpc for free-tier users', async () => {
    const subscriptionQuery = createSelectQuery({
      data: {
        id: 'sub-free',
        user_id: 'user-free',
        stripe_subscription_id: null,
        stripe_price_id: null,
        tier: 'free',
        status: 'active',
        monthly_fuel_allowance: 0,
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: false,
        trial_end: null,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-06T00:00:00.000Z',
      },
      error: null,
    })

    const rpc = vi.fn().mockResolvedValue({
      data: [{ refilled: true, amount: 100 }],
      error: null,
    })

    vi.mocked(createClient).mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'subscriptions') return subscriptionQuery
        throw new Error(`Unexpected table ${table}`)
      }),
      rpc,
    } as never)

    await expect(checkAndProcessDailyRefill('user-free')).resolves.toEqual({
      refilled: true,
      amount: 100,
    })
    expect(rpc).toHaveBeenCalledWith('process_daily_refill', {
      p_user_id: 'user-free',
      p_refill_amount: 100,
    })
  })

  it('falls back to a calculated next refill time in the billing status payload', async () => {
    const fuelBalanceQuery = createSelectQuery({
      data: {
        id: 'fuel-balance-2',
        user_id: 'user-free',
        current_fuel: 75,
        lifetime_fuel_purchased: 0,
        lifetime_fuel_used: 25,
        last_daily_refill_at: '2026-03-06T15:30:00.000Z',
        last_monthly_refill_at: null,
        user_timezone: 'UTC',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-06T15:30:00.000Z',
      },
      error: null,
    })

    const subscriptionQuery = createSelectQuery({
      data: {
        id: 'sub-free',
        user_id: 'user-free',
        stripe_subscription_id: null,
        stripe_price_id: null,
        tier: 'free',
        status: 'active',
        monthly_fuel_allowance: 0,
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: false,
        trial_end: null,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-06T00:00:00.000Z',
      },
      error: null,
    })

    vi.mocked(createClient).mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'fuel_balances') return fuelBalanceQuery
        if (table === 'subscriptions') return subscriptionQuery
        throw new Error(`Unexpected table ${table}`)
      }),
    } as never)

    const status = await getBillingStatus('user-free')
    const expectedNextRefill = new Date('2026-03-06T15:30:00.000Z')
    expectedNextRefill.setDate(expectedNextRefill.getDate() + 1)
    expectedNextRefill.setHours(0, 0, 0, 0)

    expect(status).toMatchObject({
      currentFuel: 75,
      tier: 'free',
      canPurchaseFuel: false,
    })
    expect(status.nextRefillAt?.toISOString()).toBe(expectedNextRefill.toISOString())
  })
})
