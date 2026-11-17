/**
 * Input validation and configuration normalization.
 *
 * Every value that reaches a config file, a filesystem path, a subprocess
 * argument or a URL passes through this module. The rules live here once so
 * the HTTP actions, the persistence loader and the UI all agree on what is
 * accepted.
 *
 * @module dsh-ops-console/src/validation
 */

import { randomUUID } from 'node:crypto'

/** Countries offered for the overseas probe group. */
export const GLOBAL_COUNTRY_CHOICES = Object.freeze(['US', 'DE', 'JP', 'SG', 'GB', 'AU'])

/** Hard caps that keep a personal profile's state file small. */
export const LIMITS = Object.freeze({
  sites: 50,
  servers: 30,
  repos: 20,
  projects: 30,
  historyPoints: [10, 200],
  intervalMinutes: [5, 120],
  cnProbes: [1, 3],
  globalCountries: 4,
})

/** Optional mainland-China city filter for Globalping. Empty means any CN city. */
export const CN_CITY_CHOICES = Object.freeze([
  'Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu', 'Hangzhou',
  'Wuhan', 'Nanjing', 'Chongqing', 'Tianjin', 'Suzhou', "Xi'an",
])

/** Settings defaults. Frozen; callers always receive a fresh copy. */
export const DEFAULT_SETTINGS = Object.freeze({
  monitorEnabled: true,
  intervalMinutes: 15,
  cnProbes: 2,
  cnCity: '',
  globalCountries: Object.freeze(['US', 'DE']),
  historyPoints: 60,
  accountId: '',
})

/** Error carrying a stable code and an optional user-facing hint. */
export class ValidationError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, hint?: string }} [extra]
   */
  constructor(message, extra = {}) {
    super(message)
    this.name = 'ValidationError'
    this.code = typeof extra.code === 'string' ? extra.code : 'invalid_input'
    this.hint = typeof extra.hint === 'string' ? extra.hint : ''
  }
}

/**
 * @param {string} message
 * @param {string} [code]
 * @param {string} [hint]
 * @returns {never}
 */
function fail(message, code = 'invalid_input', hint = '') {
  throw new ValidationError(message, { code, hint })
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Return a fresh mutable copy of the default settings.
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function defaultSettings() {
  return {
    ...DEFAULT_SETTINGS,
    globalCountries: [...DEFAULT_SETTINGS.globalCountries],
  }
}

/**
 * Empty configuration.
 * @returns {object}
 */
export function emptyConfig() {
  return {
    version: 1,
    settings: defaultSettings(),
    sites: [],
    servers: [],
    github: { repos: [] },
    cloudflare: { projects: [] },
  }
}

/**
 * Normalize a site URL. Bare hosts default to HTTPS. Query strings and
 * fragments are removed: they are not needed for a reachability check and
 * often contain private tokens.
 *
 * @param {unknown} input
 * @returns {{ url: string, host: string }}
 */
export function normalizeSiteUrl(input) {
  let raw = text(input)
  if (raw === '') fail('站点地址不能为空', 'invalid_url', '示例：https://example.com/')
  if (raw.length > 2048) fail('站点地址过长', 'invalid_url')
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return fail('站点地址不是合法 URL', 'invalid_url', '示例：https://example.com/')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail('只支持 http/https 站点', 'invalid_url')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    fail('站点地址不能包含用户名或密码', 'invalid_url', '请把需要鉴权的路径当作公开站点处理，或先移除账密。')
  }
  if (parsed.hostname === '') fail('站点地址缺少主机名', 'invalid_url')
  parsed.hash = ''
  parsed.search = ''
  const url = parsed.toString()
  if (url.length > 2048) fail('站点地址过长', 'invalid_url')
  return { url, host: parsed.hostname }
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {number} max
 * @returns {string}
 */
function boundedLabel(value, label, max) {
  const name = text(value)
  if (name.length > max) fail(`${label}过长（最多 ${max} 个字符）`)
  return name
}

/**
 * Build a new site. Throws ValidationError.
 * @param {{ name?: unknown, url?: unknown, enabled?: unknown }} input
 * @returns {object}
 */
export function createSite(input) {
  if (!isRecord(input)) fail('缺少站点信息')
  const { url, host } = normalizeSiteUrl(input.url)
  const name = boundedLabel(input.name, '站点名称', 80) || host
  return {
    id: `site_${randomUUID()}`,
    name,
    url,
    host,
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    createdAt: Date.now(),
  }
}

/**
 * Validate an existing site-shaped record when loading config.
 * @param {unknown} value
 * @returns {object|null}
 */
function restoreSite(value) {
  if (!isRecord(value)) return null
  try {
    const { url, host } = normalizeSiteUrl(value.url)
    const name = boundedLabel(value.name, '站点名称', 80) || host
    const id = /^[A-Za-z0-9_-]{1,80}$/u.test(String(value.id)) ? String(value.id) : `site_${randomUUID()}`
    return {
      id,
      name,
      url,
      host,
      enabled: value.enabled === undefined ? true : Boolean(value.enabled),
      createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    }
  } catch {
    return null
  }
}

/**
 * @param {unknown} value
 * @param {string} [label]
 * @returns {string}
 */
export function normalizeServerTarget(value, label = '服务器地址') {
  const target = text(value)
  if (target === '') fail(`${label}不能为空`, 'invalid_server', '可以填 ssh 别名、域名或 IP。')
  if (target.length > 255) fail(`${label}过长`, 'invalid_server')
  if (target.startsWith('-')) fail(`${label}不能以 - 开头`, 'invalid_server')
  if (target.includes('@')) fail(`${label}不要包含用户名`, 'invalid_server', '请在“用户”一栏填写用户名。')
  if (target.includes('/') || target.includes('\\') || /\s/u.test(target)) {
    fail(`${label}包含不允许的字符`, 'invalid_server')
  }
  if (!/^[A-Za-z0-9._:[\]%$@-]+$/u.test(target)) fail(`${label}包含不允许的字符`, 'invalid_server')
  return target
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeServerUser(value) {
  const user = text(value)
  if (user === '') return ''
  if (user.length > 64) fail('用户名过长', 'invalid_server')
  if (user.startsWith('-') || !/^[A-Za-z0-9._-]+$/u.test(user)) fail('用户名包含不允许的字符', 'invalid_server')
  return user
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
export function normalizePort(value) {
  if (value === undefined || value === null || value === '') return null
  const port = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('端口必须是 1–65535 的整数', 'invalid_server')
  return port
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeIdentityFile(value) {
  const file = text(value)
  if (file === '') return ''
  if (file.length > 512) fail('私钥路径过长', 'invalid_server')
  if (file.startsWith('-')) fail('私钥路径不能以 - 开头', 'invalid_server')
  if (/[\0\r\n]/u.test(file)) fail('私钥路径包含控制字符', 'invalid_server')
  return file
}

/**
 * Build a new SSH server definition.
 * @param {{ label?: unknown, target?: unknown, user?: unknown, port?: unknown, identityFile?: unknown }} input
 * @returns {object}
 */
export function createServer(input) {
  if (!isRecord(input)) fail('缺少服务器信息')
  const target = normalizeServerTarget(input.target)
  const label = boundedLabel(input.label, '服务器名称', 80) || target
  return {
    id: `srv_${randomUUID()}`,
    label,
    target,
    user: normalizeServerUser(input.user),
    port: normalizePort(input.port),
    identityFile: normalizeIdentityFile(input.identityFile),
    enabled: true,
    createdAt: Date.now(),
  }
}

/**
 * Validate an edit to an existing server while preserving its identity.
 * @param {object} current restored server record.
 * @param {{ label?: unknown, target?: unknown, user?: unknown, port?: unknown, identityFile?: unknown }} input
 * @returns {object}
 */
export function updateServer(current, input) {
  if (!isRecord(current)) fail('服务器不存在', 'not_found')
  if (!isRecord(input)) fail('缺少服务器信息')
  const target = normalizeServerTarget(input.target)
  return {
    ...current,
    label: boundedLabel(input.label, '服务器名称', 80) || target,
    target,
    user: normalizeServerUser(input.user),
    port: normalizePort(input.port),
    identityFile: normalizeIdentityFile(input.identityFile),
  }
}

/**
 * @param {unknown} value
 * @returns {object|null}
 */
function restoreServer(value) {
  if (!isRecord(value)) return null
  try {
    const target = normalizeServerTarget(value.target)
    const id = /^[A-Za-z0-9_-]{1,80}$/u.test(String(value.id)) ? String(value.id) : `srv_${randomUUID()}`
    return {
      id,
      label: boundedLabel(value.label, '服务器名称', 80) || target,
      target,
      user: normalizeServerUser(value.user),
      port: normalizePort(value.port),
      identityFile: normalizeIdentityFile(value.identityFile),
      enabled: value.enabled === undefined ? true : Boolean(value.enabled),
      createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    }
  } catch {
    return null
  }
}

/**
 * Normalize an `owner/name` repository.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeRepo(value) {
  const raw = text(value).replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/u, '')
  const parts = raw.split('/')
  if (parts.length !== 2) fail('仓库格式应为 owner/name', 'invalid_repo', '例如：lioez/my-site')
  const [owner, name] = parts
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(owner)) fail('GitHub owner 不合法', 'invalid_repo')
  if (!/^[A-Za-z0-9._-]{1,100}$/u.test(name) || name === '.' || name === '..') fail('GitHub 仓库名不合法', 'invalid_repo')
  return `${owner}/${name}`
}

/**
 * @param {string} repo normalized repo.
 * @returns {string}
 */
export function repoId(repo) {
  return `gh_${repo.toLowerCase().replace(/[^a-z0-9]+/gu, '_')}`.slice(0, 80)
}

/**
 * @param {unknown} value
 * @returns {object}
 */
export function createRepo(value) {
  const repo = normalizeRepo(value)
  return { id: repoId(repo), repo, addedAt: Date.now() }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeProject(value) {
  const project = text(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/u.test(project)) {
    fail('Cloudflare Pages 项目名不合法', 'invalid_project', '从已列出的项目中选择，或刷新后重试。')
  }
  return project
}

/**
 * @param {unknown} value
 * @returns {object}
 */
export function createProject(value) {
  const project = normalizeProject(value)
  return { id: `cf_${project}`.slice(0, 80), project, addedAt: Date.now() }
}

/**
 * Merge and validate a settings patch.
 *
 * @param {unknown} patch
 * @param {object} [base]
 * @returns {object} the complete, normalized settings.
 */
export function normalizeSettings(patch, base = defaultSettings()) {
  if (!isRecord(patch)) fail('设置格式不正确')
  const next = {
    ...base,
    globalCountries: Array.isArray(base.globalCountries) ? [...base.globalCountries] : [...DEFAULT_SETTINGS.globalCountries],
    cnCity: typeof base.cnCity === 'string' ? base.cnCity : '',
  }

  if (patch.monitorEnabled !== undefined) {
    if (typeof patch.monitorEnabled !== 'boolean') fail('监控开关必须是布尔值')
    next.monitorEnabled = patch.monitorEnabled
  }

  if (patch.intervalMinutes !== undefined) {
    const value = Number(patch.intervalMinutes)
    if (!Number.isInteger(value) || value < LIMITS.intervalMinutes[0] || value > LIMITS.intervalMinutes[1]) {
      fail('监控间隔必须是 5–120 的整数分钟')
    }
    next.intervalMinutes = value
  }

  if (patch.cnProbes !== undefined) {
    const value = Number(patch.cnProbes)
    if (!Number.isInteger(value) || value < LIMITS.cnProbes[0] || value > LIMITS.cnProbes[1]) {
      fail('国内探测节点数必须是 1–3 的整数')
    }
    next.cnProbes = value
  }

  if (patch.cnCity !== undefined) {
    const city = text(patch.cnCity)
    if (city !== '' && !CN_CITY_CHOICES.includes(city)) fail(`不支持的国内节点城市：${city}`)
    next.cnCity = city
  }

  if (patch.globalCountries !== undefined) {
    if (!Array.isArray(patch.globalCountries)) fail('海外节点国家必须是数组')
    const seen = new Set()
    for (const raw of patch.globalCountries) {
      const code = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
      if (!GLOBAL_COUNTRY_CHOICES.includes(code)) fail(`不支持的海外节点：${code || '(空)'}`)
      seen.add(code)
    }
    if (seen.size === 0) fail('至少选择一个海外节点国家')
    if (seen.size > LIMITS.globalCountries) fail(`最多选择 ${LIMITS.globalCountries} 个海外国家`)
    next.globalCountries = [...seen]
  }

  if (patch.historyPoints !== undefined) {
    const value = Number(patch.historyPoints)
    if (!Number.isInteger(value) || value < LIMITS.historyPoints[0] || value > LIMITS.historyPoints[1]) {
      fail('历史点数是 10–200 的整数')
    }
    next.historyPoints = value
  }

  if (patch.accountId !== undefined) {
    const id = text(patch.accountId)
    if (id !== '' && !/^[A-Za-z0-9-]{1,64}$/u.test(id)) fail('Cloudflare 账号 ID 不合法')
    next.accountId = id
  }

  return next
}

/**
 * @param {unknown} value
 * @returns {object}
 */
function restoreSettings(value) {
  if (!isRecord(value)) return defaultSettings()
  try {
    return normalizeSettings(value, defaultSettings())
  } catch {
    return defaultSettings()
  }
}

/**
 * Normalize a loaded configuration. Invalid entries are dropped rather than
 * failing the whole plugin; duplicates are removed by their stable identity.
 *
 * @param {unknown} raw
 * @returns {object}
 */
export function normalizeConfig(raw) {
  if (!isRecord(raw)) return emptyConfig()
  const config = emptyConfig()
  config.settings = restoreSettings(raw.settings)

  const siteIds = new Set()
  const siteUrls = new Set()
  if (Array.isArray(raw.sites)) {
    for (const value of raw.sites) {
      if (config.sites.length >= LIMITS.sites) break
      const site = restoreSite(value)
      if (site === null || siteIds.has(site.id) || siteUrls.has(site.url)) continue
      siteIds.add(site.id)
      siteUrls.add(site.url)
      config.sites.push(site)
    }
  }

  const serverIds = new Set()
  const serverKeys = new Set()
  if (Array.isArray(raw.servers)) {
    for (const value of raw.servers) {
      if (config.servers.length >= LIMITS.servers) break
      const server = restoreServer(value)
      if (server === null) continue
      const key = `${server.user}@${server.target}:${server.port ?? 22}`
      if (serverIds.has(server.id) || serverKeys.has(key)) continue
      serverIds.add(server.id)
      serverKeys.add(key)
      config.servers.push(server)
    }
  }

  const repos = new Set()
  if (isRecord(raw.github) && Array.isArray(raw.github.repos)) {
    for (const value of raw.github.repos) {
      if (config.github.repos.length >= LIMITS.repos) break
      try {
        const repo = normalizeRepo(value?.repo ?? value)
        if (repos.has(repo.toLowerCase())) continue
        repos.add(repo.toLowerCase())
        const addedAt = Number.isFinite(value?.addedAt) ? value.addedAt : Date.now()
        config.github.repos.push({ id: repoId(repo), repo, addedAt })
      } catch {
        // skip invalid entries
      }
    }
  }

  const projects = new Set()
  if (isRecord(raw.cloudflare) && Array.isArray(raw.cloudflare.projects)) {
    for (const value of raw.cloudflare.projects) {
      if (config.cloudflare.projects.length >= LIMITS.projects) break
      try {
        const project = normalizeProject(value?.project ?? value)
        if (projects.has(project)) continue
        projects.add(project)
        const addedAt = Number.isFinite(value?.addedAt) ? value.addedAt : Date.now()
        config.cloudflare.projects.push({ id: `cf_${project}`.slice(0, 80), project, addedAt })
      } catch {
        // skip invalid entries
      }
    }
  }

  return config
}
