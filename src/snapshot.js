/**
 * Snapshot assembly for the browser.
 *
 * The UI must be able to render a useful page even before the first check
 * finishes, so this module only reads cached state and reconciles it with the
 * current watchlist. It never performs network I/O.
 *
 * @module dsh-ops-console/src/snapshot
 */

/**
 * @param {unknown} history
 * @returns {number|null}
 */
export function uptimeOf(history) {
  if (!Array.isArray(history) || history.length === 0) return null
  const available = history.filter((point) => point?.status === 'up' || point?.status === 'degraded').length
  return Math.round((available / history.length) * 1000) / 10
}

/**
 * Classify one site's last check into up / degraded / down.
 *
 * @param {object|null} last
 * @returns {{ status: string, reasons: string[] }}
 */
export function classifySite(last) {
  if (!last || typeof last !== 'object') return { status: 'unknown', reasons: [] }
  const reasons = []
  const local = last.local
  let status = 'up'

  if (!local || typeof local !== 'object') {
    return { status: 'unknown', reasons: [] }
  }
  if (local.error?.code === 'ABORT_ERR' || /取消|cancel|abort/iu.test(String(local.error?.message ?? ''))) {
    return { status: 'unknown', reasons: ['上一次检测被取消，等待重新检测'] }
  }
  if (!local.reachable) {
    status = 'down'
    if (local.error?.message) reasons.push(local.error.message)
  } else if (local.status === 401 || local.status === 403) {
    status = 'degraded'
    reasons.push(`本机返回 HTTP ${local.status}，可能被鉴权或 WAF 拦截`)
  } else if (!(local.status >= 200 && local.status < 400)) {
    status = 'down'
    reasons.push(`本机返回 HTTP ${local.status ?? '—'}`)
  }

  if (local.tls && local.tls.valid === false) {
    if (status === 'up') status = 'degraded'
    reasons.push(`TLS 证书无效${local.tls.error ? `：${local.tls.error}` : ''}`)
  } else if (Number.isFinite(local.tls?.daysLeft) && local.tls.daysLeft >= 0 && local.tls.daysLeft < 14) {
    if (status === 'up') status = 'degraded'
    reasons.push(`TLS 证书 ${local.tls.daysLeft} 天后到期`)
  }

  for (const [label, group] of [
    ['国内', last.cn],
    ['海外', last.global],
  ]) {
    if (!group || group.skipped || !Number.isFinite(group.total) || group.total === 0) continue
    if (group.success === 0) {
      if (status === 'up') status = 'degraded'
      reasons.push(`${label}节点全部失败`)
    } else if (group.failed > 0) {
      if (status === 'up') status = 'degraded'
      reasons.push(`${label}节点 ${group.failed}/${group.total} 失败`)
    }
  }

  if (last.error?.message && reasons.length === 0) reasons.push(last.error.message)
  return { status, reasons }
}

/**
 * @param {unknown} value
 * @returns {Array<object>}
 */
function arrayOf(value) {
  return Array.isArray(value) ? value : []
}

/**
 * @param {unknown} value
 * @returns {object}
 */
function recordOf(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
}

/**
 * Build the payload for `GET /api/ops-console/snapshot`.
 *
 * @param {object} options
 * @param {object} options.config
 * @param {object} options.cache
 * @param {object} options.monitor snapshot source.
 * @param {string} options.dataDir
 * @param {string} options.version
 * @returns {object}
 */
export function buildSnapshot({ config, cache, monitor, dataDir, version }) {
  const c = recordOf(config)
  const k = recordOf(cache)
  const settings = recordOf(c.settings)
  const pending = monitor?.pending?.() ?? { sites: [], servers: [], github: false, cloudflare: false, connections: false }
  const pendingSites = new Set(arrayOf(pending.sites))
  const pendingServers = new Set(arrayOf(pending.servers))

  const sites = arrayOf(c.sites).map((site) => {
    const cached = recordOf(recordOf(k.sites)[site.id])
    const last = cached.last && typeof cached.last === 'object' ? cached.last : null
    const history = arrayOf(cached.history)
    const classified = classifySite(last)
    return {
      ...site,
      pending: pendingSites.has(site.id),
      uptimePct: uptimeOf(history),
      last: last
        ? {
            ...last,
            status: classified.status,
            reasons: classified.reasons,
          }
        : null,
      history,
    }
  })

  const servers = arrayOf(c.servers).map((server) => {
    const cached = recordOf(recordOf(k.servers)[server.id])
    const last = cached.last && typeof cached.last === 'object' ? cached.last : null
    return {
      ...server,
      pending: pendingServers.has(server.id),
      last,
      history: arrayOf(cached.history),
    }
  })

  const githubCache = recordOf(k.github)
  const githubRepos = arrayOf(c.github?.repos).map((entry) => {
    const cached = recordOf(recordOf(githubCache.repos)[entry.id])
    return {
      id: entry.id,
      repo: entry.repo,
      addedAt: entry.addedAt,
      state: typeof cached.state === 'string' ? cached.state : 'idle',
      error: cached.error ?? null,
      repoInfo: cached.repoInfo ?? null,
      runs: arrayOf(cached.runs),
      openPRs: cached.openPRs ?? { count: 0, items: [] },
      fetchedAt: Number.isFinite(cached.fetchedAt) ? cached.fetchedAt : 0,
    }
  })

  const cfCache = recordOf(k.cloudflare)
  const projects = arrayOf(c.cloudflare?.projects).map((entry) => {
    const cached = recordOf(recordOf(cfCache.projects)[entry.id])
    return {
      id: entry.id,
      project: entry.project,
      addedAt: entry.addedAt,
      state: typeof cached.state === 'string' ? cached.state : 'idle',
      error: cached.error ?? null,
      domains: arrayOf(cached.domains),
      gitProvider: cached.gitProvider ?? null,
      lastModified: typeof cached.lastModified === 'string' ? cached.lastModified : '',
      dashboardUrl: typeof cached.dashboardUrl === 'string' ? cached.dashboardUrl : '',
      deployments: arrayOf(cached.deployments),
      fetchedAt: Number.isFinite(cached.fetchedAt) ? cached.fetchedAt : 0,
    }
  })

  const catalog = arrayOf(cfCache.catalog).map((item) => ({
    project: typeof item?.project === 'string' ? item.project : '',
    domains: arrayOf(item?.domains),
    gitProvider: item?.gitProvider ?? null,
    lastModified: typeof item?.lastModified === 'string' ? item.lastModified : '',
    dashboardUrl: typeof item?.dashboardUrl === 'string' ? item.dashboardUrl : '',
  })).filter((item) => item.project !== '')

  return {
    ok: true,
    now: Date.now(),
    plugin: {
      version,
      dataDir,
      monitorEnabled: settings.monitorEnabled === true,
      intervalMinutes: Number.isFinite(settings.intervalMinutes) ? settings.intervalMinutes : 15,
      running: Boolean(monitor?.running?.()),
      lastRunAt: Number.isFinite(k.monitor?.lastRunAt) && k.monitor.lastRunAt > 0 ? k.monitor.lastRunAt : null,
      nextRunAt: Number.isFinite(k.monitor?.nextRunAt) && k.monitor.nextRunAt > 0 ? k.monitor.nextRunAt : null,
      pending: {
        sites: arrayOf(pending.sites),
        servers: arrayOf(pending.servers),
        github: Boolean(pending.github),
        cloudflare: Boolean(pending.cloudflare),
        connections: Boolean(pending.connections),
      },
    },
    settings: {
      monitorEnabled: settings.monitorEnabled === true,
      intervalMinutes: Number.isFinite(settings.intervalMinutes) ? settings.intervalMinutes : 15,
      cnProbes: Number.isFinite(settings.cnProbes) ? settings.cnProbes : 2,
      globalCountries: arrayOf(settings.globalCountries),
      historyPoints: Number.isFinite(settings.historyPoints) ? settings.historyPoints : 60,
      accountId: typeof settings.accountId === 'string' ? settings.accountId : '',
    },
    tools: monitor?.tools?.() ?? {},
    github: {
      state: typeof githubCache.state === 'string' ? githubCache.state : 'idle',
      account: githubCache.account ?? null,
      version: typeof githubCache.version === 'string' ? githubCache.version : '',
      error: githubCache.error ?? null,
      lastFetchedAt: Number.isFinite(githubCache.lastFetchedAt) ? githubCache.lastFetchedAt : 0,
      repos: githubRepos,
    },
    cloudflare: {
      state: typeof cfCache.state === 'string' ? cfCache.state : 'idle',
      account: cfCache.account ?? null,
      accounts: arrayOf(cfCache.accounts),
      permissionsCount: Number.isFinite(cfCache.permissionsCount) ? cfCache.permissionsCount : 0,
      version: typeof cfCache.version === 'string' ? cfCache.version : '',
      error: cfCache.error ?? null,
      lastFetchedAt: Number.isFinite(cfCache.lastFetchedAt) ? cfCache.lastFetchedAt : 0,
      projects,
      catalog,
    },
    sites,
    servers,
    globalping: {
      remaining: Number.isFinite(k.globalping?.remaining) ? k.globalping.remaining : null,
      limit: Number.isFinite(k.globalping?.limit) ? k.globalping.limit : null,
      resetIn: Number.isFinite(k.globalping?.resetIn) ? k.globalping.resetIn : null,
      fetchedAt: Number.isFinite(k.globalping?.fetchedAt) ? k.globalping.fetchedAt : 0,
      cooldownUntil: Number.isFinite(k.globalping?.cooldownUntil) ? k.globalping.cooldownUntil : null,
      error: k.globalping?.error ?? null,
    },
  }
}
