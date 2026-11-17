/**
 * Cloudflare Pages provider.
 *
 * `wrangler` is the only credential source: the plugin does not read the
 * OAuth store, does not require an API token and never writes a secret. v1
 * intentionally exposes Pages projects and recent deployments only; zones,
 * DNS and Workers need a different API surface and are left as dashboard
 * links instead of a half-working imitation.
 *
 * @module dsh-ops-console/src/providers/cloudflare
 */

import { commandFailure, extractJson, runCli } from '../cli.js'

/** Hint when wrangler is missing. */
export const CLOUDFLARE_INSTALL_HINT = '安装 Wrangler（npm install -g wrangler）后重新检测。'
/** Hint when wrangler is present but signed out. */
export const CLOUDFLARE_AUTH_HINT = '在终端运行 `wrangler login`，完成后回到运维台点“重新检测”。'

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * @param {object} result
 * @param {string} [fallback]
 * @returns {{ code: string, message: string, hint: string }}
 */
function cfError(result, fallback = 'Cloudflare 检测失败') {
  if (!result?.installed) {
    return { code: 'cli_missing', message: '没有找到 wrangler', hint: CLOUDFLARE_INSTALL_HINT }
  }
  return {
    code: 'cloudflare_error',
    message: commandFailure(result, fallback),
    hint: '确认 wrangler 已登录，且当前账号有 Pages 权限。',
  }
}

/**
 * @param {object} result
 * @returns {string}
 */
function versionOf(result) {
  return String(result?.stdout ?? '').split(/\r?\n/u)[0]?.trim().slice(0, 120) ?? ''
}

/**
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.run]
 * @param {string} [options.accountId]
 * @returns {Promise<{ state: string, account: object|null, accounts: object[], permissionsCount: number, version: string, error: object|null }>}
 */
export async function detectCloudflare(options = {}) {
  const run = options.run ?? runCli
  const versionResult = await run('wrangler', ['--version'], { timeoutMs: 10_000, signal: options.signal, cwd: options.cwd })
  if (!versionResult.installed) {
    return {
      state: 'not-installed',
      account: null,
      accounts: [],
      permissionsCount: 0,
      version: '',
      error: { code: 'cli_missing', message: '没有找到 wrangler', hint: CLOUDFLARE_INSTALL_HINT },
    }
  }
  const version = versionOf(versionResult)

  const whoami = await run('wrangler', ['whoami', '--json'], { timeoutMs: 20_000, signal: options.signal, cwd: options.cwd })
  const parsed = extractJson(whoami.stdout)
  if (!whoami.ok || !parsed) {
    return {
      state: 'error',
      account: null,
      accounts: [],
      permissionsCount: 0,
      version,
      error: cfError(whoami, '无法读取 Wrangler 登录状态'),
    }
  }
  if (parsed.loggedIn !== true) {
    return {
      state: 'not-authenticated',
      account: null,
      accounts: [],
      permissionsCount: 0,
      version,
      error: { code: 'auth_required', message: 'Wrangler 尚未登录', hint: CLOUDFLARE_AUTH_HINT },
    }
  }

  const accounts = (Array.isArray(parsed.accounts) ? parsed.accounts : [])
    .filter((item) => typeof item?.id === 'string' && item.id !== '')
    .map((item) => ({ id: item.id, name: text(item.name) || item.id }))
  const requested = text(options.accountId)
  const account = accounts.find((item) => item.id === requested) ?? accounts[0] ?? null
  const permissions = Array.isArray(parsed.tokenPermissions) ? parsed.tokenPermissions : []

  return {
    state: 'connected',
    account: account
      ? { ...account, email: text(parsed.email) }
      : null,
    accounts,
    permissionsCount: permissions.length,
    version,
    error: null,
  }
}

/**
 * @param {unknown} raw
 * @returns {Array<object>}
 */
export function parsePagesProjects(raw) {
  if (!Array.isArray(raw)) return []
  const projects = []
  for (const item of raw) {
    const project = text(item?.['Project Name'])
    if (project === '') continue
    const domains = text(item?.['Project Domains'])
      .split(/\s*,\s*/u)
      .filter(Boolean)
    const gitProvider = text(item?.['Git Provider'])
    projects.push({
      project,
      domains,
      gitProvider: gitProvider === '' ? null : gitProvider !== 'No',
      lastModified: text(item?.['Last Modified']),
    })
  }
  return projects
}

/**
 * @param {unknown} raw
 * @returns {Array<object>}
 */
export function parseDeployments(raw) {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 5).map((item) => ({
    id: text(item?.Id),
    environment: text(item?.Environment),
    branch: text(item?.Branch),
    source: text(item?.Source),
    url: text(item?.Deployment),
    statusText: text(item?.Status),
    buildUrl: text(item?.Build),
  }))
}

/**
 * @param {string} accountId
 * @param {string} project
 * @returns {string}
 */
export function projectDashboardUrl(accountId, project) {
  const prefix = accountId ? `https://dash.cloudflare.com/${encodeURIComponent(accountId)}` : 'https://dash.cloudflare.com'
  return `${prefix}/pages/view/${encodeURIComponent(project)}`
}

/**
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.run]
 * @param {string} [options.accountId]
 * @returns {Promise<{ ok: boolean, projects: object[], error: object|null }>}
 */
export async function fetchPagesProjects(options = {}) {
  const run = options.run ?? runCli
  const env = options.accountId ? { CLOUDFLARE_ACCOUNT_ID: options.accountId } : undefined
  const result = await run('wrangler', ['pages', 'project', 'list', '--json'], {
    timeoutMs: 25_000,
    signal: options.signal,
    env,
    cwd: options.cwd,
  })
  if (!result.ok) return { ok: false, projects: [], error: cfError(result, '无法列出 Pages 项目') }
  const parsed = extractJson(result.stdout)
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      projects: [],
      error: { code: 'bad_output', message: 'wrangler 没有返回 Pages 项目列表', hint: '升级 wrangler 后重试。' },
    }
  }
  return { ok: true, projects: parsePagesProjects(parsed), error: null }
}

/**
 * @param {string} project
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.run]
 * @param {string} [options.accountId]
 * @returns {Promise<{ ok: boolean, deployments: object[], error: object|null }>}
 */
export async function fetchPagesDeployments(project, options = {}) {
  const run = options.run ?? runCli
  const env = options.accountId ? { CLOUDFLARE_ACCOUNT_ID: options.accountId } : undefined
  const result = await run('wrangler', [
    'pages', 'deployment', 'list',
    '--project-name', project,
    '--json',
  ], { timeoutMs: 25_000, signal: options.signal, env, cwd: options.cwd })
  if (!result.ok) return { ok: false, deployments: [], error: cfError(result, `无法读取 ${project} 的部署`) }
  const parsed = extractJson(result.stdout)
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      deployments: [],
      error: { code: 'bad_output', message: 'wrangler 没有返回部署列表', hint: '升级 wrangler 后重试。' },
    }
  }
  return { ok: true, deployments: parseDeployments(parsed), error: null }
}
