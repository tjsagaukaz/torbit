import { NextApiHandler } from 'next'
import { runWithCorrelation, createCorrelationId } from './correlation'
import { info, error } from './logger.server'

export function withCorrelation(handler: NextApiHandler): NextApiHandler {
  return async (req, res) => {
    const header = req.headers['x-correlation-id'] as string | undefined
    const cid = header || createCorrelationId()
    return runWithCorrelation(cid, async () => {
      try {
        info('api.request.start', { path: req.url, method: req.method })
        await handler(req, res)
        info('api.request.end', { status: res.statusCode })
      } catch (err: unknown) {
        error('api.request.error', { message: err instanceof Error ? err.message : String(err) })
        throw err
      }
    })
  }
}
