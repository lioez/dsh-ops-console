/**
 * dsh-ops-console — Host entry.
 *
 * The plugin is deliberately dependency-free: it only imports Node built-ins
 * and its own modules. A missing peer package must never take down the page.
 * The browser half is shipped as `client.js`; the package manifest tells DSH
 * where to find it.
 *
 * @module dsh-ops-console
 */

import { createLogger, describeError } from './src/log.js'
import { createMonitor } from './src/monitor.js'
import { resolveDataDir } from './src/paths.js'
import { buildRoutes } from './src/routes.js'
import { createStore } from './src/state.js'

/** Package version mirrored in package.json. */
const VERSION = '0.2.0'

export const name = 'dsh-ops-console'

/**
 * Mount the plugin.
 *
 * @param {any} ctx Cordis context.
 * @param {unknown} _config row config (unused; user state lives in the data dir).
 * @returns {Promise<void>}
 */
export async function apply(ctx, _config) {
  const logger = createLogger(ctx, 'ops-console')
  const dataDir = resolveDataDir()

  const store = createStore({ dataDir, logger })
  await store.load()

  const monitor = createMonitor({ store, logger })
  ctx.effect(() => {
    void monitor.start().catch((error) => logger.warn('monitor start failed: %s', describeError(error)))
    return () => {
      void monitor.stop().catch((error) => logger.warn('monitor stop failed: %s', describeError(error)))
    }
  }, 'ops-console: monitor lifecycle')

  const routes = buildRoutes({ store, monitor, logger, version: VERSION })

  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], (connectionCtx) => {
      for (const route of routes) {
        connectionCtx.effect(
          () => connectionCtx.connection.fetch.register(route),
          `ops-console: route ${route.path}`,
        )
      }
    })
  } else {
    logger.warn('ctx.inject is unavailable; the console routes cannot be registered')
  }

  logger.info('ops console ready at %s', dataDir)
}
