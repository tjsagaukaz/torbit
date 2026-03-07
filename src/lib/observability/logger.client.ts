import * as Sentry from '@sentry/nextjs'
import { getClientCorrelationId } from './clientCorrelation'
import {
  formatStructuredLog,
  type LogLevel,
  type LogMeta,
} from './logger.shared'

const SENTRY_LEVEL_MAP: Record<LogLevel, 'info' | 'warning' | 'error' | 'debug'> = {
  info: 'info',
  warn: 'warning',
  error: 'error',
  debug: 'debug',
}

export function log(level: LogLevel, message: string, meta: LogMeta = {}) {
  const line = formatStructuredLog(level, message, meta, getClientCorrelationId())

  if (level === 'error') console.error(line)
  else console.log(line)

  try {
    if (level === 'error') Sentry.captureException(new Error(message))
    else Sentry.addBreadcrumb({ message, level: SENTRY_LEVEL_MAP[level] })
  } catch {
    // Ignore Sentry failures in the browser.
  }
}

export const info = (msg: string, meta?: LogMeta) => log('info', msg, meta)
export const warn = (msg: string, meta?: LogMeta) => log('warn', msg, meta)
export const error = (msg: string, meta?: LogMeta) => log('error', msg, meta)
export const debug = (msg: string, meta?: LogMeta) => log('debug', msg, meta)
