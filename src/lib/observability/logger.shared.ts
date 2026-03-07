export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export type LogMeta = Record<string, unknown>

type StructuredLogPayload = LogMeta & {
  ts: string
  level: LogLevel
  message: string
  correlationId?: string
}

export function formatStructuredLog(
  level: LogLevel,
  message: string,
  meta: LogMeta = {},
  correlationId?: string
) {
  const payload: StructuredLogPayload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  }

  if (correlationId) {
    payload.correlationId = correlationId
  }

  return JSON.stringify(payload)
}
