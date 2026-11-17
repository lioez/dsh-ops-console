/**
 * Monitoring orchestration.
 *
 * This is the only place that decides when a network probe or a CLI query
 * runs. The HTTP routes stay thin: they validate an action, mutate config or
 * start one of these jobs, and return. The browser learns progress from the
 * snapshot (`pending` flags), not from a long-held request.
 *
 * @module dsh-ops-console/src/monitor
 */

import { resolveExecutable, runCli } from './cli.js'
import { describeError } from './log.js'
import { classifySite } from './snapshot.js'
import { probeGlobalping, fetchLimits } from './probes/globalping.js'
import { probeLocal } from './probes/local-http.js'
import { detectCloudflare, fetchPagesDeployments, fetchPagesProjects, projectDashboardUrl } from './providers/cloudflare.js'
import { detectGithub, fetchRepo, validateRepoAccess } from './providers/github.js'
import { probeServer } from './providers/ssh.js'

/** How often the scheduler wakes to check whether a run is due. */
const TICK_MS = 30_000
/** Provider caches are refreshed at most this often. */
const PROVIDER_TTL_MS = 10 * 60_000
/** Globalping limit cache TTL. */
const LIMIT_TTL_MS = 60_000
/** Failed measurements cool down this long. */
const RATE_LIMIT_COOLDOWN_MS = 15 * 60_000

/**
 * @param {unknown[]} items
 * @param {number} limit
 * @param {(item: any) => Promise<any>} worker
 * @returns {Promise<any[]>}
 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let index = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index
      index += 1
      try {
        results[current] = await worker(items[current])
      } catch (error) {
        results[current] = { ok: false, error: describeError(error) }
      }
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * @param {object[]} history
 * @param {object} point
 * @param {number} max
 * @returns {object[]}
 */
function appendHistory(history, point, max) {
  const next = Array.isArray(history) ? history.slice(-Math.max(0, max - 1)) : []
  next.push(point)
  return next
}

/**
 * @param {object[]} nodes
 * @returns {object}
 */
function emptyGroup(reason = '') {
  return {
    total: 0,
    success: 0,
    failed: 0,
    medianMs: null,
    minMs: null,
    maxMs: null,
    skipped: true,
    error: reason === '' ? null : { code: 'skipped', message: reason },
    nodes: [],
    failures: [],
  }
}

/**
 * Create the monitor for one plugin instance.
 *
 * @param {object} options
 * @param {ReturnType<import('./state.js').createStore>} options.store
 * @param {any} [options.logger]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {Function} [options.run]
 */
export function createMonitor({ store, logger, fetchImpl = fetch, run = runCli }) {
  const rootAbort = new AbortController()
  const pending = {
    sites: new Set(),
    servers: new Set(),
    github: false,
    cloudflare: false,
    connections: false,
  }
  let timer = null
  let cycleRunning = false
  let tools = {}
  let cooldownUntil = Number.isFinite(store.getCache().globalping?.cooldownUntil) && store.getCache().globalping.cooldownUntil > Date.now()
    ? store.getCache().globalping.cooldownUntil
    : 0
  let started = false

  function config() {
    return store.getConfig()
  }

  function cache() {
    return store.getCache()
  }

  function historyLimit() {
    return config().settings?.historyPoints ?? 60
  }

  function signal() {
    return rootAbort.signal
  }

  function isAborted() {
    return rootAbort.signal.aborted
  }

  async function refreshTools() {
    const versionOf = async (name, args) => {
      const resolved = resolveExecutable(name)
      if (!resolved.installed) return { installed: false, path: resolved.path, version: '', error: resolved.error }
      const result = await run(name, args, { timeoutMs: 8_000, signal: signal() })
      const raw = `${result.stdout}\n${result.stderr}`.split(/\r?\n/u).find((line) => line.trim() !== '') ?? ''
      return {
        installed: true,
        path: resolved.path,
        version: raw.trim().slice(0, 120),
        error: result.ok ? '' : describeError(result.error),
      }
    }
    const [ssh, gh, wrangler] = await Promise.all([
      versionOf('ssh', ['-V']),
      versionOf('gh', ['--version']),
      versionOf('wrangler', ['--version']),
    ])
    tools = { ssh, gh, wrangler }
    return tools
  }

  function toolsSnapshot() {
    return tools
  }

  function pendingSnapshot() {
    return {
      sites: [...pending.sites],
      servers: [...pending.servers],
      github: pending.github,
      cloudflare: pending.cloudflare,
      connections: pending.connections,
    }
  }

  async function loadLimits(force = false) {
    const current = cache().globalping
    if (!force && Date.now() - (current.fetchedAt ?? 0) < LIMIT_TTL_MS) return current
    const limits = await fetchLimits({ fetchImpl, signal: signal() })
    await store.updateCacheBestEffort((draft) => {
      draft.globalping = {
        ...draft.globalping,
        ...limits,
        cooldownUntil: cooldownUntil > Date.now() ? cooldownUntil : draft.globalping?.cooldownUntil ?? null,
      }
    })
    return cache().globalping
  }

  /**
   * @param {object} site
   * @param {{ manual?: boolean }} [options]
   * @returns {Promise<object>}
   */
  async function checkSite(site, options = {}) {
    if (pending.sites.has(site.id)) return { ok: true, skipped: true, reason: 'already-pending' }
    if (isAborted()) return { ok: false, error: 'cancelled' }
    pending.sites.add(site.id)
    const settings = config().settings
    const checkedAt = Date.now()

    try {
      let limits = await loadLimits(false)
      let skipGlobal = ''
      const probeCount = Math.max(1, Number(settings.cnProbes) || 2) + Math.max(1, settings.globalCountries?.length ?? 2)
      if (cooldownUntil > Date.now()) skipGlobal = 'Globalping 限流冷却中'
      else if (limits?.remaining !== null && Number.isFinite(limits.remaining) && limits.remaining < probeCount) {
        skipGlobal = `Globalping 剩余额度不足（${limits.remaining}）`
      }

      const globalPromise = skipGlobal !== ''
        ? Promise.resolve({
            ok: false,
            measurementId: null,
            cn: emptyGroup(skipGlobal),
            global: emptyGroup(skipGlobal),
            probesCount: 0,
            error: { code: 'skipped', message: skipGlobal },
          })
        : probeGlobalping(site, {
            cnProbes: settings.cnProbes,
            globalCountries: settings.globalCountries,
            timeoutMs: 30_000,
            signal: signal(),
            fetchImpl,
          }).catch((error) => ({
            ok: false,
            measurementId: null,
            cn: emptyGroup('Globalping 探测失败'),
            global: emptyGroup('Globalping 探测失败'),
            probesCount: 0,
            error: { code: 'globalping_error', message: describeError(error) },
          }))

      const [local, gp] = await Promise.all([
        probeLocal(site.url, { timeoutMs: 15_000, signal: signal() }),
        globalPromise,
      ])

      if (gp.error?.code === 'rate_limited') {
        cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS
        await store.updateCacheBestEffort((draft) => {
          draft.globalping = {
            ...draft.globalping,
            cooldownUntil,
            error: gp.error.message,
          }
        })
      } else if (!skipGlobal) {
        // Keep the displayed quota reasonably fresh after a measurement.
        void loadLimits(true)
      }

      const last = {
        checkedAt,
        status: 'unknown',
        reasons: [],
        local,
        cn: gp.cn,
        global: gp.global,
        globalping: {
          measurementId: gp.measurementId ?? null,
          probesCount: gp.probesCount ?? 0,
          error: gp.error ?? null,
        },
      }
      last.error = gp.ok ? null : gp.error ?? null
      const classified = classifySite(last)
      last.status = classified.status
      last.reasons = classified.reasons
      const point = {
        at: checkedAt,
        status: last.status,
        localMs: local?.timings?.totalMs ?? null,
        cnMs: gp.cn?.medianMs ?? null,
        globalMs: gp.global?.medianMs ?? null,
        tlsDays: local?.tls?.daysLeft ?? null,
      }

      await store.updateCacheBestEffort((draft) => {
        const entry = draft.sites[site.id] ?? { last: null, history: [] }
        entry.last = last
        entry.history = appendHistory(entry.history, point, historyLimit())
        draft.sites[site.id] = entry
      })
      return { ok: true, last }
    } catch (error) {
      logger?.warn?.('site %s check failed: %s', site.id, describeError(error))
      return { ok: false, error: describeError(error) }
    } finally {
      pending.sites.delete(site.id)
    }
  }

  /**
   * @param {object} server
   * @returns {Promise<object>}
   */
  async function checkServer(server) {
    if (pending.servers.has(server.id)) return { ok: true, skipped: true, reason: 'already-pending' }
    if (isAborted()) return { ok: false, error: 'cancelled' }
    pending.servers.add(server.id)
    try {
      const last = await probeServer(server, { timeoutMs: 20_000, signal: signal(), run })
      const point = {
        at: last.checkedAt,
        status: last.status,
        durationMs: last.durationMs,
        load1: Array.isArray(last.load) && last.load.length > 0 ? last.load[0] : null,
        memPct: last.memory?.usedPct ?? null,
        diskPct: last.disk?.usedPct ?? null,
      }
      await store.updateCacheBestEffort((draft) => {
        const entry = draft.servers[server.id] ?? { last: null, history: [] }
        entry.last = last
        entry.history = appendHistory(entry.history, point, historyLimit())
        draft.servers[server.id] = entry
      })
      return { ok: true, last }
    } catch (error) {
      logger?.warn?.('server %s check failed: %s', server.id, describeError(error))
      return { ok: false, error: describeError(error) }
    } finally {
      pending.servers.delete(server.id)
    }
  }

  async function checkAllSites(options = {}) {
    const sites = config().sites.filter((site) => site.enabled !== false)
    return mapLimit(sites, 2, (site) => checkSite(site, options))
  }

  async function checkAllServers() {
    const servers = config().servers.filter((server) => server.enabled !== false)
    return mapLimit(servers, 2, (server) => checkServer(server))
  }

  async function refreshConnections() {
    if (pending.connections) return { ok: true, skipped: true }
    pending.connections = true
    await store.updateCacheBestEffort((draft) => {
      draft.github.state = 'checking'
      draft.cloudflare.state = 'checking'
    })
    try {
      const [gh, cf] = await Promise.all([
        detectGithub({ signal: signal(), run }),
        detectCloudflare({ signal: signal(), run, accountId: config().settings.accountId, cwd: store.dataDir }),
      ])
      await store.updateCacheBestEffort((draft) => {
        draft.github = {
          ...draft.github,
          state: gh.state,
          account: gh.account,
          version: gh.version,
          error: gh.error,
        }
        draft.cloudflare = {
          ...draft.cloudflare,
          state: cf.state,
          account: cf.account,
          accounts: cf.accounts,
          permissionsCount: cf.permissionsCount,
          version: cf.version,
          error: cf.error,
        }
      })
      await refreshTools()
      void loadLimits(true)
      return { ok: true, github: gh, cloudflare: cf }
    } catch (error) {
      logger?.warn?.('connection detection failed: %s', describeError(error))
      await store.updateCacheBestEffort((draft) => {
        draft.github = { ...draft.github, state: 'error', error: { code: 'detect_failed', message: describeError(error) } }
        draft.cloudflare = { ...draft.cloudflare, state: 'error', error: { code: 'detect_failed', message: describeError(error) } }
      })
      return { ok: false, error: describeError(error) }
    } finally {
      pending.connections = false
    }
  }

  async function refreshGithub() {
    if (pending.github) return { ok: true, skipped: true }
    pending.github = true
    try {
      const gh = await detectGithub({ signal: signal(), run })
      if (gh.state !== 'connected') {
        await store.updateCacheBestEffort((draft) => {
          draft.github = {
            ...draft.github,
            state: gh.state,
            account: gh.account,
            version: gh.version,
            error: gh.error,
            lastFetchedAt: Date.now(),
          }
        })
        return { ok: gh.state === 'connected', error: gh.error }
      }

      const repos = config().github.repos
      const results = await mapLimit(repos, 2, async (entry) => {
        const value = await fetchRepo(entry.repo, { signal: signal(), run })
        return { entry, value }
      })
      await store.updateCacheBestEffort((draft) => {
        const next = {}
        for (const entry of repos) {
          const result = results.find((item) => item?.entry?.id === entry.id)
          const previous = draft.github.repos[entry.id] ?? {}
          if (!result) {
            next[entry.id] = {
              ...previous,
              repo: entry.repo,
              state: 'error',
              error: { code: 'refresh_failed', message: `刷新 ${entry.repo} 失败` },
              fetchedAt: Date.now(),
            }
            continue
          }
          const value = result.value ?? {}
          if (value.state === 'error') {
            next[entry.id] = {
              ...previous,
              repo: entry.repo,
              state: 'error',
              error: value.error,
              fetchedAt: value.fetchedAt ?? Date.now(),
            }
          } else {
            next[entry.id] = {
              ...previous,
              ...value,
              repo: entry.repo,
              error: null,
            }
          }
        }
        draft.github = {
          ...draft.github,
          state: 'connected',
          account: gh.account,
          version: gh.version,
          error: null,
          lastFetchedAt: Date.now(),
          repos: next,
        }
      })
      return { ok: true }
    } catch (error) {
      logger?.warn?.('github refresh failed: %s', describeError(error))
      await store.updateCacheBestEffort((draft) => {
        draft.github = {
          ...draft.github,
          state: 'error',
          error: { code: 'refresh_failed', message: describeError(error) },
          lastFetchedAt: Date.now(),
        }
      })
      return { ok: false, error: describeError(error) }
    } finally {
      pending.github = false
    }
  }

  async function refreshCloudflare() {
    if (pending.cloudflare) return { ok: true, skipped: true }
    pending.cloudflare = true
    try {
      const cf = await detectCloudflare({ signal: signal(), run, accountId: config().settings.accountId, cwd: store.dataDir })
      if (cf.state !== 'connected') {
        await store.updateCacheBestEffort((draft) => {
          draft.cloudflare = {
            ...draft.cloudflare,
            state: cf.state,
            account: cf.account,
            accounts: cf.accounts,
            permissionsCount: cf.permissionsCount,
            version: cf.version,
            error: cf.error,
            lastFetchedAt: Date.now(),
          }
        })
        return { ok: cf.state === 'connected', error: cf.error }
      }

      const accountId = cf.account?.id ?? config().settings.accountId
      const previousCatalog = store.getCache().cloudflare.catalog ?? []
      const catalogResult = await fetchPagesProjects({ signal: signal(), run, accountId, cwd: store.dataDir })
      const catalog = catalogResult.ok
        ? (catalogResult.projects ?? []).map((item) => ({
            ...item,
            dashboardUrl: projectDashboardUrl(accountId, item.project),
          }))
        : previousCatalog
      const watched = config().cloudflare.projects
      const results = await mapLimit(watched, 2, async (entry) => {
        const result = await fetchPagesDeployments(entry.project, { signal: signal(), run, accountId, cwd: store.dataDir })
        const projectMeta = catalog.find((item) => item.project === entry.project)
        return {
          entry,
          meta: projectMeta,
          result,
        }
      })

      await store.updateCacheBestEffort((draft) => {
        const next = {}
        const previousAll = draft.cloudflare.projects ?? {}
        for (const entry of watched) {
          const item = results.find((candidate) => candidate?.entry?.id === entry.id)
          const previous = previousAll[entry.id] ?? {}
          if (!item) {
            next[entry.id] = {
              ...previous,
              project: entry.project,
              state: 'error',
              error: { code: 'refresh_failed', message: `刷新 ${entry.project} 失败` },
              fetchedAt: Date.now(),
            }
            continue
          }
          next[entry.id] = {
            ...previous,
            project: entry.project,
            domains: item.meta?.domains ?? previous.domains ?? [],
            gitProvider: item.meta?.gitProvider ?? previous.gitProvider ?? null,
            lastModified: item.meta?.lastModified ?? previous.lastModified ?? '',
            dashboardUrl: item.meta?.dashboardUrl ?? projectDashboardUrl(accountId, entry.project),
            state: item.result.ok ? 'ok' : 'error',
            error: item.result.ok ? null : item.result.error,
            deployments: item.result.ok ? item.result.deployments : previous.deployments ?? [],
            fetchedAt: Date.now(),
          }
        }
        draft.cloudflare = {
          ...draft.cloudflare,
          state: 'connected',
          account: cf.account,
          accounts: cf.accounts,
          permissionsCount: cf.permissionsCount,
          version: cf.version,
          error: catalogResult.ok ? null : catalogResult.error,
          lastFetchedAt: Date.now(),
          projects: next,
          catalog,
        }
      })
      return { ok: true }
    } catch (error) {
      logger?.warn?.('cloudflare refresh failed: %s', describeError(error))
      await store.updateCacheBestEffort((draft) => {
        draft.cloudflare = {
          ...draft.cloudflare,
          state: 'error',
          error: { code: 'refresh_failed', message: describeError(error) },
          lastFetchedAt: Date.now(),
        }
      })
      return { ok: false, error: describeError(error) }
    } finally {
      pending.cloudflare = false
    }
  }

  async function runCycle(reason = 'schedule') {
    if (cycleRunning || isAborted()) return { ok: false, skipped: true }
    cycleRunning = true
    const startedAt = Date.now()
    try {
      await store.updateCacheBestEffort((draft) => {
        draft.monitor.lastRunAt = startedAt
        draft.monitor.nextRunAt = 0
      })
      const settings = config().settings
      if (settings.monitorEnabled) {
        await checkAllSites()
        await checkAllServers()
        const gh = cache().github
        const cf = cache().cloudflare
        if (!gh.lastFetchedAt || Date.now() - gh.lastFetchedAt > PROVIDER_TTL_MS) await refreshGithub()
        if (!cf.lastFetchedAt || Date.now() - cf.lastFetchedAt > PROVIDER_TTL_MS) await refreshCloudflare()
      }
      const nextRunAt = settings.monitorEnabled
        ? Date.now() + Math.max(5, Number(settings.intervalMinutes) || 15) * 60_000
        : 0
      await store.updateCacheBestEffort((draft) => {
        draft.monitor.lastRunAt = startedAt
        draft.monitor.nextRunAt = nextRunAt
        draft.monitor.lastError = null
      })
      return { ok: true, reason, startedAt, nextRunAt }
    } catch (error) {
      logger?.warn?.('monitor cycle failed: %s', describeError(error))
      await store.updateCacheBestEffort((draft) => {
        draft.monitor.lastRunAt = startedAt
        draft.monitor.nextRunAt = Date.now() + 5 * 60_000
        draft.monitor.lastError = describeError(error)
      })
      return { ok: false, error: describeError(error) }
    } finally {
      cycleRunning = false
    }
  }

  async function tick() {
    if (!started || isAborted()) return
    const settings = config().settings
    if (!settings.monitorEnabled) return
    const next = cache().monitor.nextRunAt
    if (!next || Date.now() >= next) void runCycle('schedule')
  }

  async function start() {
    if (started) return
    started = true
    // A first, cheap pass so the page is not empty on a fresh install.
    void (async () => {
      await refreshTools()
      await refreshConnections()
      if (config().github.repos.length > 0) await refreshGithub()
      if (config().cloudflare.projects.length > 0) await refreshCloudflare()
    })().catch((error) => logger?.warn?.('startup detection failed: %s', describeError(error)))

    if ((cache().monitor.nextRunAt ?? 0) === 0) {
      await store.updateCacheBestEffort((draft) => {
        draft.monitor.nextRunAt = Date.now() + 20_000
      })
    }
    timer = setInterval(() => {
      void tick()
    }, TICK_MS)
  }

  async function stop() {
    started = false
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    rootAbort.abort()
    await store.flush()
  }

  async function reschedule() {
    const settings = config().settings
    const next = settings.monitorEnabled
      ? Date.now() + Math.max(5, Number(settings.intervalMinutes) || 15) * 60_000
      : 0
    await store.updateCacheBestEffort((draft) => {
      draft.monitor.nextRunAt = next
    })
    return next
  }

  async function refreshAll() {
    await refreshConnections()
    await refreshGithub()
    await refreshCloudflare()
    await checkAllSites()
    await checkAllServers()
    await store.updateCacheBestEffort((draft) => {
      draft.monitor.lastRunAt = Date.now()
      draft.monitor.nextRunAt = config().settings.monitorEnabled
        ? Date.now() + Math.max(5, Number(config().settings.intervalMinutes) || 15) * 60_000
        : 0
    })
  }

  return {
    start,
    stop,
    reschedule,
    refreshTools,
    validateRepo: (repo) => validateRepoAccess(repo, { signal: signal(), run }),
    refreshConnections,
    refreshGithub,
    refreshCloudflare,
    refreshAll,
    checkSite,
    checkServer,
    checkAllSites,
    checkAllServers,
    runCycle,
    pending: pendingSnapshot,
    tools: toolsSnapshot,
    running: () => cycleRunning,
    config,
    cache,
    dataDir: store.dataDir,
  }
}
