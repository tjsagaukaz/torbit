import { timingSafeEqual } from 'crypto'

function normalizeToken(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function timingSafeTokenMatch(candidate: string, tokens: string[]): boolean {
  const candidateBuf = Buffer.from(candidate)
  for (const token of tokens) {
    const tokenBuf = Buffer.from(token)
    if (candidateBuf.length === tokenBuf.length && timingSafeEqual(candidateBuf, tokenBuf)) {
      return true
    }
  }
  return false
}

export function parseBearerToken(authorizationHeader: string | null | undefined): string | null {
  const value = normalizeToken(authorizationHeader)
  if (!value) return null

  const match = value.match(/^Bearer\s+(.+)$/i)
  if (!match) return null

  return normalizeToken(match[1])
}

export function getConfiguredWorkerTokens(env: NodeJS.ProcessEnv = process.env): string[] {
  const tokens = [
    normalizeToken(env.TORBIT_WORKER_TOKEN),
    normalizeToken(env.CRON_SECRET),
  ].filter((token): token is string => Boolean(token))

  return [...new Set(tokens)]
}

export function authorizeWorkerRequest(
  headers: Pick<Headers, 'get'>,
  env: NodeJS.ProcessEnv = process.env
): { ok: true; method: 'header-token' | 'bearer-token' } | { ok: false; error: string } {
  const configuredTokens = getConfiguredWorkerTokens(env)

  if (configuredTokens.length === 0) {
    return {
      ok: false,
      error: 'Worker authorization is not configured. Set TORBIT_WORKER_TOKEN or CRON_SECRET.',
    }
  }

  const headerToken = normalizeToken(headers.get('x-torbit-worker-token'))
  const bearerToken = parseBearerToken(headers.get('authorization'))

  if (!headerToken && !bearerToken) {
    return {
      ok: false,
      error: 'Missing worker token. Provide x-torbit-worker-token or Authorization: Bearer <token>.',
    }
  }

  if (headerToken && timingSafeTokenMatch(headerToken, configuredTokens)) {
    return {
      ok: true,
      method: 'header-token',
    }
  }

  if (bearerToken && timingSafeTokenMatch(bearerToken, configuredTokens)) {
    return {
      ok: true,
      method: 'bearer-token',
    }
  }

  return {
    ok: false,
    error: 'Invalid worker token.',
  }
}
