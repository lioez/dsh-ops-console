/**
 * GitHub provider.
 *
 * Reuses the `gh` CLI's existing login. The console never reads a token file
 * and never stores a token. Everything here is a read-only query.
 *
 * @module dsh-ops-console/src/providers/github
 */

import { commandFailure, extractJson, runCli } from '../cli.js'

/** Hint shown when gh is present but signed out. */
export const GITHUB_AUTH_HINT = '在终端运行 `gh auth login`，完成后回到运维台点“重新检测”。'
/** Hint shown when gh is absent. */
export const GITHUB_INSTALL_HINT = '安装 GitHub CLI（brew install gh）后重新检测。'

/**
 * @param {object} result runCli result.
 * @param {string} [fallback]
 * @returns {{ code: string, message: string, hint: string }}
 */
function authError(result, fallback = 'GitHub 检测失败') {
  if (!result?.installed) {
    return { code: 'cli_missing', message: '没有找到 gh', hint: GITHUB_INSTALL_HINT }
  }
  return {
    code: 'auth_required',
    message: commandFailure(result, fallback),
    hint: GITHUB_AUTH_HINT,
  }
}

/**
 * @param {object} runCliResult
 * @returns {string}
 */
function versionOf(runCliResult) {
  const first = String(runCliResult?.stdout ?? '').split(/\r?\n/u)[0] ?? ''
  return first.trim().slice(0, 120)
}

/**
 * Detect the gh installation and login state.
 *
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.run]
 * @returns {Promise<{ state: string, account: object|null, version: string, error: object|null }>}
 */
export async function detectGithub(options = {}) {
  const run = options.run ?? runCli
  const versionResult = await run('gh', ['--version'], { timeoutMs: 8_000, signal: options.signal })
  if (!versionResult.installed) {
    return {
      state: 'not-installed',
      account: null,
      version: '',
      error: { code: 'cli_missing', message: '没有找到 gh', hint: GITHUB_INSTALL_HINT },
    }
  }
  const version = versionOf(versionResult)

  const authResult = await run('gh', ['auth', 'status', '--json', 'hosts'], {
    timeoutMs: 12_000,
    signal: options.signal,
  })
  const parsed = extractJson(authResult.stdout)
  const hostEntries = Array.isArray(parsed?.hosts?.['github.com']) ? parsed.hosts['github.com'] : []
  const active = hostEntries.find((entry) => entry?.active === true) ?? hostEntries.find((entry) => entry?.state === 'success')
  if (!active || active.state !== 'success') {
    return {
      state: 'not-authenticated',
      account: null,
      version,
      error: authError(authResult, 'gh 尚未登录 GitHub'),
    }
  }

  let login = typeof active.login === 'string' ? active.login : ''
  if (login === '') {
    const user = await run('gh', ['api', 'user', '--jq', '.login'], { timeoutMs: 12_000, signal: options.signal })
    if (user.ok) login = user.stdout.trim()
  }

  return {
    state: 'connected',
    account: login === '' ? null : { login, url: `https://github.com/${login}` },
    version,
    error: null,
  }
}

/**
 * Validate that a repository is visible to the current gh login.
 *
 * @param {string} repo
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, error: object|null }>}
 */
export async function validateRepoAccess(repo, options = {}) {
  const run = options.run ?? runCli
  const result = await run('gh', ['repo', 'view', repo, '--json', 'nameWithOwner'], {
    timeoutMs: 12_000,
    signal: options.signal,
  })
  if (!result.ok) {
    const haystack = `${result.stderr ?? ''}\n${result.error ?? ''}`
    if (/HTTP 404|Not Found|Could not resolve to a Repository/iu.test(haystack)) {
      return {
        ok: false,
        error: {
          code: 'repo_not_found',
          message: `找不到仓库 ${repo}，或当前账号没有访问权限`,
          hint: '确认 owner/name 拼写；私有仓库需要当前 gh 账号有权限。',
        },
      }
    }
    return { ok: false, error: authError(result, `无法访问仓库 ${repo}`) }
  }
  const parsed = extractJson(result.stdout)
  if (!parsed || typeof parsed.nameWithOwner !== 'string') {
    return {
      ok: false,
      error: { code: 'repo_not_found', message: `无法读取仓库 ${repo}`, hint: '确认 owner/name 拼写，以及当前 gh 账号是否有访问权限。' },
    }
  }
  return { ok: true, error: null }
}

/**
 * Read one repository's summary, recent workflow runs and open pull requests.
 *
 * @param {string} repo
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.run]
 * @returns {Promise<object>}
 */
export async function fetchRepo(repo, options = {}) {
  const run = options.run ?? runCli
  const signal = options.signal
  const fetchedAt = Date.now()

  const view = await run('gh', [
    'repo', 'view', repo,
    '--json', 'nameWithOwner,url,description,visibility,defaultBranchRef',
  ], { timeoutMs: 12_000, signal })
  const info = extractJson(view.stdout)
  if (!view.ok || !info) {
    return {
      repo,
      state: 'error',
      error: view.ok
        ? { code: 'repo_unreadable', message: `无法读取仓库 ${repo}`, hint: '确认仓库仍存在且当前 gh 账号有访问权限。' }
        : authError(view, `无法读取仓库 ${repo}`),
      repoInfo: null,
      runs: [],
      openPRs: { count: 0, items: [] },
      fetchedAt,
    }
  }

  const [runsResult, prsResult] = await Promise.all([
    run('gh', [
      'run', 'list',
      '-R', repo,
      '-L', '3',
      '--json', 'databaseId,workflowName,displayTitle,status,conclusion,headBranch,createdAt,url',
    ], { timeoutMs: 15_000, signal }),
    run('gh', [
      'pr', 'list',
      '-R', repo,
      '--state', 'open',
      '--limit', '50',
      '--json', 'number,title,url,updatedAt',
    ], { timeoutMs: 15_000, signal }),
  ])

  const rawRuns = extractJson(runsResult.stdout)
  const runs = Array.isArray(rawRuns)
    ? rawRuns.slice(0, 3).map((item) => ({
        id: Number.isFinite(item?.databaseId) ? item.databaseId : null,
        workflow: typeof item?.workflowName === 'string' ? item.workflowName : '',
        title: typeof item?.displayTitle === 'string' ? item.displayTitle : '',
        status: typeof item?.status === 'string' ? item.status : '',
        conclusion: typeof item?.conclusion === 'string' ? item.conclusion : '',
        branch: typeof item?.headBranch === 'string' ? item.headBranch : '',
        createdAt: typeof item?.createdAt === 'string' ? item.createdAt : '',
        url: typeof item?.url === 'string' ? item.url : '',
      }))
    : []

  const rawPrs = extractJson(prsResult.stdout)
  const prItems = Array.isArray(rawPrs)
    ? rawPrs.map((item) => ({
        number: Number.isFinite(item?.number) ? item.number : 0,
        title: typeof item?.title === 'string' ? item.title : '',
        url: typeof item?.url === 'string' ? item.url : '',
        updatedAt: typeof item?.updatedAt === 'string' ? item.updatedAt : '',
      }))
    : []

  const repoInfo = {
    nameWithOwner: typeof info.nameWithOwner === 'string' ? info.nameWithOwner : repo,
    url: typeof info.url === 'string' ? info.url : `https://github.com/${repo}`,
    description: typeof info.description === 'string' ? info.description : '',
    visibility: typeof info.visibility === 'string' ? info.visibility : '',
    defaultBranch: typeof info.defaultBranchRef?.name === 'string' ? info.defaultBranchRef.name : '',
  }

  return {
    repo,
    state: 'ok',
    error: null,
    repoInfo,
    runs,
    openPRs: { count: prItems.length, items: prItems },
    fetchedAt,
  }
}
