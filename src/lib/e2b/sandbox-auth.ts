import crypto from 'node:crypto'

export interface SandboxAccessTokenPayload {
  v: 1
  sandboxId: string
  userId: string
  iat: number
  exp: number
}

const DEFAULT_TTL_SECONDS = 60 * 60 // 1h

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8')
}

function signPayload(encodedPayload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url')
}

function safeEqualSignature(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, 'utf8')
  const bBuffer = Buffer.from(b, 'utf8')
  if (aBuffer.length !== bBuffer.length) return false
  return crypto.timingSafeEqual(aBuffer, bBuffer)
}

export function getSandboxAccessTokenSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  // Only allow dedicated signing secrets. Never fall back to database admin keys
  // (SUPABASE_SERVICE_ROLE_KEY) or API keys (E2B_API_KEY) — a leaked sandbox token
  // would otherwise grant unrelated elevated access.
  return (
    env.TORBIT_SANDBOX_SIGNING_SECRET ||
    env.NEXTAUTH_SECRET ||
    null
  )
}

export function createSandboxAccessToken(
  sandboxId: string,
  userId: string,
  opts: { ttlSeconds?: number; nowMs?: number; secret?: string | null } = {}
): string {
  const secret = opts.secret ?? getSandboxAccessTokenSecret()
  if (!secret) {
    throw new Error('Missing sandbox access token secret')
  }

  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000)
  const exp = now + (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS)

  const payload: SandboxAccessTokenPayload = {
    v: 1,
    sandboxId,
    userId,
    iat: now,
    exp,
  }

  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signature = signPayload(encodedPayload, secret)
  return `${encodedPayload}.${signature}`
}

export function verifySandboxAccessToken(
  token: string,
  opts: { nowMs?: number; secret?: string | null } = {}
): SandboxAccessTokenPayload | null {
  const secret = opts.secret ?? getSandboxAccessTokenSecret()
  if (!secret) return null

  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [encodedPayload, providedSignature] = parts
  if (!encodedPayload || !providedSignature) return null

  const expectedSignature = signPayload(encodedPayload, secret)
  if (!safeEqualSignature(expectedSignature, providedSignature)) return null

  let payload: SandboxAccessTokenPayload
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as SandboxAccessTokenPayload
  } catch {
    return null
  }

  if (payload.v !== 1 || !payload.sandboxId || !payload.userId || !payload.exp || !payload.iat) {
    return null
  }

  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000)
  if (payload.exp <= now) return null

  return payload
}
