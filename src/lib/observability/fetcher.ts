import { getClientCorrelationId } from './clientCorrelation'
import { info as clientInfo, error as clientError } from './logger.client'

type CorrelationAwareGlobal = typeof globalThis & {
  __TORBIT_CORRELATION_ID?: string
}

async function getServerLogger() {
  return import('./logger.server')
}

async function getServerCorrelationId(): Promise<string | undefined> {
  if (typeof window !== 'undefined') return undefined
  try {
    const { getCorrelationId } = await import('./correlation')
    return getCorrelationId()
  } catch {
    return undefined
  }
}

function injectHeader(init: RequestInit | undefined, cid: string) {
  const headers = new Headers(init?.headers as HeadersInit)
  if (!headers.has('x-correlation-id')) headers.set('x-correlation-id', cid)
  return { ...init, headers }
}

export async function fetchWithCorrelation(input: RequestInfo, init?: RequestInit): Promise<Response> {
  let cid: string | undefined
  if (typeof window === 'undefined') {
    cid = await getServerCorrelationId()
  } else {
    cid = getClientCorrelationId()
  }

  // Fallback: allow tests or non-ALS environments to expose a global correlation id
  const globalWithCorrelation = globalThis as CorrelationAwareGlobal
  if (!cid && typeof globalWithCorrelation.__TORBIT_CORRELATION_ID === 'string') {
    cid = globalWithCorrelation.__TORBIT_CORRELATION_ID
  }

  const start = Date.now()
  const finalInit = cid ? injectHeader(init, cid) : init

  try {
    if (cid) {
      const { info } = await getServerLogger()
      info('outbound.request.start', { url: String(input), correlationId: cid })
    }
    const res = await fetch(input, finalInit)
    const duration = Date.now() - start
    if (cid) {
      const { info } = await getServerLogger()
      info('outbound.request.end', { url: String(input), status: res.status, duration, correlationId: cid })
    }
    return res
  } catch (err: unknown) {
    const duration = Date.now() - start
    const message = err instanceof Error ? err.message : String(err)
    if (cid) {
      const { error } = await getServerLogger()
      error('outbound.request.error', { url: String(input), message, duration, correlationId: cid })
    }
    throw err
  }
}

// Client helper for cases where caller has explicit cid (rare)
export function fetchWithCorrelationClient(input: RequestInfo, init?: RequestInit, cid?: string) {
  const correlationId = cid || getClientCorrelationId()
  const finalInit = correlationId ? injectHeader(init, correlationId) : init
  const start = Date.now()
  if (correlationId) {
    clientInfo('outbound.request.start', { url: String(input), correlationId })
  }
  return fetch(input, finalInit).then(res => {
    const duration = Date.now() - start
    if (correlationId) {
      clientInfo('outbound.request.end', { url: String(input), status: res.status, duration, correlationId })
    }
    return res
  }).catch((err: unknown) => {
    const duration = Date.now() - start
    const message = err instanceof Error ? err.message : String(err)
    if (correlationId) {
      clientError('outbound.request.error', { url: String(input), message, duration, correlationId })
    }
    throw err
  })
}

export default fetchWithCorrelation
