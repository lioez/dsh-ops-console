/**
 * Authenticated HTTP routes.
 *
 * Two exact paths are registered through `ctx.connection.fetch`, the same
 * authenticated bridge the rest of the Web UI uses. The plugin never writes
 * its own loopback/origin check: a route that bypassed the core's admission
 * would be a security bug waiting for a LAN client.
 *
 * @module dsh-ops-console/src/routes
 */

import { pickPrivateKey } from './picker.js'
import { emptyCache } from './state.js'
import { buildSnapshot } from './snapshot.js'
import {
  ValidationError,
  createProject,
  createRepo,
  createServer,
  createSite,
  normalizePort,
  normalizeProject,
  normalizeRepo,
  normalizeServerTarget,
  normalizeServerUser,
  normalizeIdentityFile,
  normalizeSettings,
} from './validation.js'

/** Maximum JSON action body. */
const ACTION_BODY_LIMIT = 64 * 1024

class ActionError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {string} [hint]
   */
  constructor(status, code, message, hint = '') {
    super(message)
    this.name = 'ActionError'
    this.status = status
    this.code = code
    this.hint = hint
  }
}

/**
 * @param {Response} response
 * @returns {Promise<object>}
 */
async function readJson(response) {
  const body = await response.text()
  if (body.length > ACTION_BODY_LIMIT) {
    throw new ActionError(413, 'body_too_large', '请求体过大')
  }
  if (body.trim() === '') throw new ActionError(400, 'invalid_input', '请求体必须是非空 JSON')
  try {
    return JSON.parse(body)
  } catch {
    throw new ActionError(400, 'invalid_json', '请求体不是合法 JSON')
  }
}

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {string}
 */
function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ActionError(400, 'invalid_input', `${name}不能为空`)
  }
  return value.trim()
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function idOf(value) {
  const id = requiredString(value, 'id')
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(id)) throw new ActionError(400, 'invalid_input', 'id 不合法')
  return id
}

/**
 * @param {object} store
 * @param {object} monitor
 * @param {any} logger
 * @returns {Promise<object>}
 */
async function handleAction(store, monitor, logger, body) {
  const type = requiredString(body?.type, 'type')
  const config = store.getConfig()

  switch (type) {
    case 'site.add': {
      const site = createSite({ name: body.name, url: body.url })
      if (config.sites.some((item) => item.url === site.url)) {
        throw new ActionError(409, 'duplicate_site', '这个站点已经在监控列表中')
      }
      await store.updateConfig((draft) => {
        draft.sites.push(site)
      })
      void monitor.checkSite(site).catch((error) => logger?.warn?.('auto site check failed: %s', error))
      return { ok: true, id: site.id }
    }

    case 'site.remove': {
      const id = idOf(body.id)
      if (!config.sites.some((item) => item.id === id)) throw new ActionError(404, 'not_found', '站点不存在')
      await store.updateConfig((draft) => {
        draft.sites = draft.sites.filter((item) => item.id !== id)
      })
      await store.updateCacheBestEffort((draft) => {
        delete draft.sites[id]
      })
      return { ok: true }
    }

    case 'site.setEnabled': {
      const id = idOf(body.id)
      if (!config.sites.some((item) => item.id === id)) throw new ActionError(404, 'not_found', '站点不存在')
      await store.updateConfig((draft) => {
        const site = draft.sites.find((item) => item.id === id)
        if (site) site.enabled = Boolean(body.enabled)
      })
      return { ok: true }
    }

    case 'site.check': {
      if (body.id !== undefined) {
        const id = idOf(body.id)
        const site = config.sites.find((item) => item.id === id)
        if (!site) throw new ActionError(404, 'not_found', '站点不存在')
        void monitor.checkSite(site).catch((error) => logger?.warn?.('site check failed: %s', error))
      } else {
        void monitor.checkAllSites().catch((error) => logger?.warn?.('site checks failed: %s', error))
      }
      return { ok: true }
    }

    case 'server.add': {
      const target = normalizeServerTarget(body.target)
      const user = normalizeServerUser(body.user)
      const port = normalizePort(body.port)
      if (config.servers.some((item) => item.target === target && item.user === user && (item.port ?? null) === port)) {
        throw new ActionError(409, 'duplicate_server', '这台服务器已经在列表中')
      }
      const server = createServer({
        label: body.label,
        target,
        user,
        port,
        identityFile: normalizeIdentityFile(body.identityFile),
      })
      await store.updateConfig((draft) => {
        draft.servers.push(server)
      })
      void monitor.checkServer(server).catch((error) => logger?.warn?.('auto server check failed: %s', error))
      return { ok: true, id: server.id }
    }

    case 'server.remove': {
      const id = idOf(body.id)
      if (!config.servers.some((item) => item.id === id)) throw new ActionError(404, 'not_found', '服务器不存在')
      await store.updateConfig((draft) => {
        draft.servers = draft.servers.filter((item) => item.id !== id)
      })
      await store.updateCacheBestEffort((draft) => {
        delete draft.servers[id]
      })
      return { ok: true }
    }

    case 'server.pickKey': {
      const picked = await pickPrivateKey()
      if (picked.ok) return { ok: true, path: picked.path }
      if (picked.code === 'cancelled') return { ok: true, cancelled: true }
      throw new ActionError(
        400,
        picked.code ?? 'picker_failed',
        picked.message ?? '无法选择私钥文件',
        picked.hint ?? '',
      )
    }

    case 'server.check': {
      if (body.id !== undefined) {
        const id = idOf(body.id)
        const server = config.servers.find((item) => item.id === id)
        if (!server) throw new ActionError(404, 'not_found', '服务器不存在')
        void monitor.checkServer(server).catch((error) => logger?.warn?.('server check failed: %s', error))
      } else {
        void monitor.checkAllServers().catch((error) => logger?.warn?.('server checks failed: %s', error))
      }
      return { ok: true }
    }

    case 'github.repo.add': {
      const repo = normalizeRepo(body.repo)
      if (config.github.repos.some((item) => item.repo.toLowerCase() === repo.toLowerCase())) {
        throw new ActionError(409, 'duplicate_repo', '这个仓库已经在监听列表中')
      }
      const validation = await monitor.validateRepo(repo)
      if (!validation.ok) {
        throw new ActionError(
          400,
          validation.error?.code ?? 'repo_invalid',
          validation.error?.message ?? '无法访问这个仓库',
          validation.error?.hint ?? '',
        )
      }
      const entry = createRepo(repo)
      await store.updateConfig((draft) => {
        draft.github.repos.push(entry)
      })
      void monitor.refreshGithub().catch((error) => logger?.warn?.('github refresh failed: %s', error))
      return { ok: true, id: entry.id }
    }

    case 'github.repo.remove': {
      const id = idOf(body.id)
      if (!config.github.repos.some((item) => item.id === id)) throw new ActionError(404, 'not_found', '仓库不在监听列表中')
      await store.updateConfig((draft) => {
        draft.github.repos = draft.github.repos.filter((item) => item.id !== id)
      })
      await store.updateCacheBestEffort((draft) => {
        delete draft.github.repos[id]
      })
      return { ok: true }
    }

    case 'github.refresh': {
      void monitor.refreshGithub().catch((error) => logger?.warn?.('github refresh failed: %s', error))
      return { ok: true }
    }

    case 'cloudflare.project.add': {
      const project = normalizeProject(body.project)
      if (config.cloudflare.projects.some((item) => item.project === project)) {
        throw new ActionError(409, 'duplicate_project', '这个 Pages 项目已经在监听列表中')
      }
      const catalog = store.getCache().cloudflare.catalog ?? []
      if (!catalog.some((item) => item.project === project)) {
        throw new ActionError(
          409,
          'project_not_discovered',
          '还没有发现这个 Pages 项目',
          '先点“刷新”读取 Cloudflare 项目列表，再添加。',
        )
      }
      const entry = createProject(project)
      await store.updateConfig((draft) => {
        draft.cloudflare.projects.push(entry)
      })
      void monitor.refreshCloudflare().catch((error) => logger?.warn?.('cloudflare refresh failed: %s', error))
      return { ok: true, id: entry.id }
    }

    case 'cloudflare.project.remove': {
      const id = idOf(body.id)
      if (!config.cloudflare.projects.some((item) => item.id === id)) {
        throw new ActionError(404, 'not_found', 'Pages 项目不在监听列表中')
      }
      await store.updateConfig((draft) => {
        draft.cloudflare.projects = draft.cloudflare.projects.filter((item) => item.id !== id)
      })
      await store.updateCacheBestEffort((draft) => {
        delete draft.cloudflare.projects[id]
      })
      return { ok: true }
    }

    case 'cloudflare.refresh': {
      void monitor.refreshCloudflare().catch((error) => logger?.warn?.('cloudflare refresh failed: %s', error))
      return { ok: true }
    }

    case 'connections.refresh': {
      void monitor.refreshConnections().catch((error) => logger?.warn?.('connection refresh failed: %s', error))
      return { ok: true }
    }

    case 'settings.save': {
      if (typeof body.settings !== 'object' || body.settings === null || Array.isArray(body.settings)) {
        throw new ActionError(400, 'invalid_input', 'settings 必须是对象')
      }
      const settings = normalizeSettings(body.settings, config.settings)
      const accountChanged = settings.accountId !== config.settings.accountId
      await store.updateConfig((draft) => {
        draft.settings = settings
      })
      await monitor.reschedule()
      if (accountChanged) {
        void monitor.refreshCloudflare().catch((error) => logger?.warn?.('cloudflare refresh failed: %s', error))
      }
      return { ok: true, settings }
    }

    case 'cache.clear': {
      const what = body.what === 'all' ? 'all' : body.what === 'history' ? 'history' : ''
      if (what === '') throw new ActionError(400, 'invalid_input', 'what 必须是 history 或 all')
      if (what === 'history') {
        await store.updateCache((draft) => {
          for (const entry of Object.values(draft.sites)) entry.history = []
          for (const entry of Object.values(draft.servers)) entry.history = []
        })
      } else {
        const fresh = emptyCache()
        await store.updateCache((draft) => {
          draft.sites = fresh.sites
          draft.servers = fresh.servers
          draft.github = fresh.github
          draft.cloudflare = fresh.cloudflare
          draft.globalping = fresh.globalping
          draft.monitor = fresh.monitor
        })
      }
      return { ok: true }
    }

    default:
      throw new ActionError(400, 'unknown_action', `未知操作：${type}`)
  }
}

/**
 * @param {unknown} error
 * @param {any} logger
 * @returns {{ status: number, body: object }}
 */
function errorResponse(error, logger) {
  if (error instanceof ValidationError) {
    return {
      status: 400,
      body: { ok: false, error: { code: error.code, message: error.message, hint: error.hint } },
    }
  }
  if (error instanceof ActionError) {
    return {
      status: error.status,
      body: { ok: false, error: { code: error.code, message: error.message, hint: error.hint } },
    }
  }
  logger?.warn?.('ops-console route failed: %s', error instanceof Error ? error.message : String(error))
  return {
    status: 500,
    body: {
      ok: false,
      error: { code: 'internal_error', message: '运维台内部错误', hint: '查看 DSH 日志获取更多信息。' },
    },
  }
}

/**
 * Build the two route definitions. The caller registers each one inside a
 * `ctx.effect`, so unloading the plugin removes the route.
 *
 * @param {object} options
 * @param {object} options.store
 * @param {object} options.monitor
 * @param {any} [options.logger]
 * @param {string} options.version
 * @returns {Array<object>}
 */
export function buildRoutes({ store, monitor, logger, version }) {
  return [
    {
      path: '/api/ops-console/snapshot',
      methods: ['GET'],
      requestBody: 'buffered',
      async fetch(request) {
        try {
          const payload = buildSnapshot({
            config: store.getConfig(),
            cache: store.getCache(),
            monitor,
            dataDir: store.dataDir,
            version,
          })
          return Response.json(payload, { headers: { 'cache-control': 'no-store' } })
        } catch (error) {
          const failure = errorResponse(error, logger)
          return Response.json(failure.body, {
            status: failure.status,
            headers: { 'cache-control': 'no-store' },
          })
        }
      },
    },
    {
      path: '/api/ops-console/action',
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        try {
          const body = await readJson(request)
          if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            throw new ActionError(400, 'invalid_input', '请求体必须是 JSON 对象')
          }
          const result = await handleAction(store, monitor, logger, body)
          return Response.json(result, { headers: { 'cache-control': 'no-store' } })
        } catch (error) {
          const failure = errorResponse(error, logger)
          return Response.json(failure.body, {
            status: failure.status,
            headers: { 'cache-control': 'no-store' },
          })
        }
      },
    },
  ]
}
