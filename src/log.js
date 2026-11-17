/**
 * Defensive logger.
 *
 * A console that cannot write a log line must still serve its page. Every
 * call is wrapped and every level degrades to a no-op.
 *
 * @module dsh-ops-console/src/log
 */

const LEVELS = ['debug', 'info', 'warn', 'error']

/**
 * @param {any} ctx plugin context.
 * @param {string} name logger namespace.
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
export function createLogger(ctx, name) {
  let logger
  try {
    const service = ctx?.logger
    logger = typeof service === 'function' ? service.call(ctx, name) : service
  } catch {
    logger = undefined
  }

  const safe = {}
  for (const level of LEVELS) {
    safe[level] = (...args) => {
      try {
        const method = logger?.[level]
        if (typeof method === 'function') method.apply(logger, args)
      } catch {
        // Logging is best effort by contract.
      }
    }
  }
  return safe
}

/**
 * Human-readable error text without a stack.
 * @param {unknown} error
 * @returns {string}
 */
export function describeError(error) {
  if (error instanceof Error) return error.message || error.name || 'Error'
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
