import { isIP } from 'node:net'

// ============================================================================
// RATE LIMITER - Distributed-first (Upstash Redis), in-memory fallback
// ============================================================================
// Production: set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// Local/dev: falls back to in-memory token bucket.
// ============================================================================

interface RateLimitEntry {
  tokens: number
  lastRefill: number
}

interface RateLimiterConfig {
  /** Maximum tokens (requests) in the bucket */
  maxTokens: number
  /** Tokens to refill per interval */
  refillRate: number
  /** Refill interval in milliseconds */
  refillInterval: number
  /** Identifier for namespacing keys */
  name?: string
}

export interface RateLimitResult {
  success: boolean
  remaining: number
  resetIn: number // milliseconds until reset
  limit: number
}

interface UpstashPipelineResult {
  result?: unknown
  error?: string
}

function isUpstashConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN)
}

class InMemoryRateLimiter {
  private buckets: Map<string, RateLimitEntry> = new Map()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(private readonly config: RateLimiterConfig) {
    if (typeof setInterval !== 'undefined') {
      this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000)
    }
  }

  check(identifier: string): RateLimitResult {
    const now = Date.now()
    let entry = this.buckets.get(identifier)

    if (!entry) {
      entry = {
        tokens: this.config.maxTokens - 1,
        lastRefill: now,
      }
      this.buckets.set(identifier, entry)
      return {
        success: true,
        remaining: entry.tokens,
        resetIn: this.config.refillInterval,
        limit: this.config.maxTokens,
      }
    }

    const timeSinceRefill = now - entry.lastRefill
    const tokensToAdd = Math.floor(timeSinceRefill / this.config.refillInterval) * this.config.refillRate

    if (tokensToAdd > 0) {
      entry.tokens = Math.min(this.config.maxTokens, entry.tokens + tokensToAdd)
      entry.lastRefill = now
    }

    if (entry.tokens > 0) {
      entry.tokens -= 1
      this.buckets.set(identifier, entry)
      return {
        success: true,
        remaining: entry.tokens,
        resetIn: Math.max(0, this.config.refillInterval - (now - entry.lastRefill)),
        limit: this.config.maxTokens,
      }
    }

    return {
      success: false,
      remaining: 0,
      resetIn: Math.max(0, this.config.refillInterval - (now - entry.lastRefill)),
      limit: this.config.maxTokens,
    }
  }

  private cleanup() {
    const now = Date.now()
    const staleThreshold = 10 * 60 * 1000

    for (const [key, entry] of this.buckets.entries()) {
      if (now - entry.lastRefill > staleThreshold) {
        this.buckets.delete(key)
      }
    }
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
  }
}

class DistributedWindowRateLimiter {
  private readonly windowMs: number
  private readonly restUrl: string
  private readonly restToken: string

  constructor(private readonly config: RateLimiterConfig) {
    this.windowMs = Math.max(
      this.config.refillInterval,
      Math.ceil((this.config.maxTokens / Math.max(1, this.config.refillRate)) * this.config.refillInterval)
    )
    this.restUrl = process.env.UPSTASH_REDIS_REST_URL!
    this.restToken = process.env.UPSTASH_REDIS_REST_TOKEN!
  }

  private async pipeline(commands: Array<unknown[]>): Promise<UpstashPipelineResult[]> {
    const response = await fetch(`${this.restUrl}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.restToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    })

    if (!response.ok) {
      throw new Error(`Upstash pipeline failed (${response.status})`)
    }

    const payload = await response.json()
    if (!Array.isArray(payload)) {
      throw new Error('Unexpected Upstash response shape')
    }

    return payload as UpstashPipelineResult[]
  }

  async check(identifier: string): Promise<RateLimitResult> {
    const now = Date.now()
    const windowSlot = Math.floor(now / this.windowMs)
    const namespace = this.config.name || 'default'
    const key = `torbit:ratelimit:${namespace}:${identifier}:${windowSlot}`

    const payload = await this.pipeline([
      ['INCR', key],
      ['PEXPIRE', key, this.windowMs, 'NX'],
      ['PTTL', key],
    ])

    const count = Number(payload[0]?.result ?? 0)
    const ttl = Number(payload[2]?.result ?? -1)
    const resetIn = ttl > 0 ? ttl : Math.max(0, this.windowMs - (now % this.windowMs))
    const remaining = Math.max(0, this.config.maxTokens - count)

    return {
      success: count <= this.config.maxTokens,
      remaining,
      resetIn,
      limit: this.config.maxTokens,
    }
  }
}

class RateLimiter {
  private readonly memoryLimiter: InMemoryRateLimiter
  private readonly distributedLimiter: DistributedWindowRateLimiter | null
  private warnedOnDistributedFailure = false

  constructor(private readonly config: RateLimiterConfig) {
    this.memoryLimiter = new InMemoryRateLimiter(config)
    this.distributedLimiter = isUpstashConfigured() ? new DistributedWindowRateLimiter(config) : null
  }

  async check(identifier: string): Promise<RateLimitResult> {
    if (this.distributedLimiter) {
      try {
        return await this.distributedLimiter.check(identifier)
      } catch (error) {
        if (!this.warnedOnDistributedFailure) {
          this.warnedOnDistributedFailure = true
          console.warn(`[RateLimiter:${this.config.name || 'default'}] Falling back to in-memory limiter`, error)
        }
      }
    }

    return this.memoryLimiter.check(identifier)
  }

  destroy() {
    this.memoryLimiter.destroy()
  }
}

export const chatRateLimiter = new RateLimiter({
  name: 'chat',
  maxTokens: 30,
  refillRate: 2,
  refillInterval: 3000,
})

export const strictRateLimiter = new RateLimiter({
  name: 'strict',
  maxTokens: 5,
  refillRate: 1,
  refillInterval: 12000,
})

// Higher-throughput limiter for authenticated, bursty sandbox file sync and host probes.
export const e2bSyncRateLimiter = new RateLimiter({
  name: 'e2b-sync',
  maxTokens: 300,
  refillRate: 30,
  refillInterval: 1000,
})

// Per-Stripe-customer limiter for webhook events. Prevents billing fraud if the
// webhook secret is ever leaked — an attacker cannot spam fuel credits beyond this
// threshold even with a valid signature.
export const stripeWebhookRateLimiter = new RateLimiter({
  name: 'stripe-webhook',
  maxTokens: 20,
  refillRate: 5,
  refillInterval: 60_000, // 20 events per customer per minute
})

function normalizeClientIp(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  // IPv6 can include optional brackets and zone id.
  const withoutBrackets = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed
  const withoutZoneId = withoutBrackets.split('%')[0]
  if (isIP(withoutZoneId)) return withoutZoneId

  // Handle IPv4 with optional source port.
  const ipv4WithPort = withoutZoneId.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/)
  if (ipv4WithPort && isIP(ipv4WithPort[1]) === 4) {
    return ipv4WithPort[1]
  }

  return null
}

function extractClientIpFromHeader(
  headerValue: string | null,
  options: { useLastHop?: boolean } = {}
): string | null {
  if (!headerValue) return null

  const parts = headerValue.split(',').map((part) => part.trim()).filter(Boolean)
  const candidates = options.useLastHop ? [...parts].reverse() : parts
  for (const candidate of candidates) {
    const normalized = normalizeClientIp(candidate)
    if (normalized) return normalized
  }

  return null
}

export function getClientIP(request: Request): string {
  // Prefer platform-provided single-IP headers.
  const platformHeaders = [
    request.headers.get('x-vercel-forwarded-for'),
    request.headers.get('cf-connecting-ip'),
    request.headers.get('x-real-ip'),
  ]
  for (const headerValue of platformHeaders) {
    const ip = extractClientIpFromHeader(headerValue)
    if (ip) return ip
  }

  // X-Forwarded-For is easier to spoof. Prefer the last hop over the first.
  const forwardedFor = extractClientIpFromHeader(
    request.headers.get('x-forwarded-for'),
    { useLastHop: true }
  )
  if (forwardedFor) return forwardedFor

  return 'unknown'
}

export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: 'Rate limit exceeded',
      message: 'Too many requests. Please slow down.',
      retryAfter: Math.ceil(result.resetIn / 1000),
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': result.limit.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': Math.ceil(result.resetIn / 1000).toString(),
        'Retry-After': Math.ceil(result.resetIn / 1000).toString(),
      },
    }
  )
}
