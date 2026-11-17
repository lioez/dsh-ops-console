/**
 * Narrow subprocess boundary.
 *
 * The console runs `gh`, `wrangler` and `ssh` on the user's machine. This
 * module is the only place allowed to start them: arguments are always arrays,
 * output is bounded, every call has a timeout, and GUI-launched processes get
 * a PATH that still finds Homebrew tools.
 *
 * @module dsh-ops-console/src/cli
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Environment variable overrides used by tests and power users. */
const OVERRIDES = Object.freeze({
  gh: 'OPS_CONSOLE_GH_BIN',
  wrangler: 'OPS_CONSOLE_WRANGLER_BIN',
  ssh: 'OPS_CONSOLE_SSH_BIN',
})

/** Extra PATH entries for a Finder-launched Electron app. */
const EXTRA_PATHS = Object.freeze([
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  path.join(os.homedir(), '.local', 'bin'),
])

/** Max bytes captured from one command. */
const MAX_OUTPUT = 4 * 1024 * 1024

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function usablePath(env = process.env) {
  const existing = typeof env.PATH === 'string' ? env.PATH.split(path.delimiter) : []
  const seen = new Set()
  const all = []
  for (const dir of [...EXTRA_PATHS, ...existing]) {
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    all.push(dir)
  }
  return all.join(path.delimiter)
}

/**
 * Build the environment used by every child process.
 * @param {Record<string,string>} [extra]
 * @returns {NodeJS.ProcessEnv}
 */
export function childEnv(extra = {}) {
  return {
    ...process.env,
    ...extra,
    PATH: usablePath(process.env),
    NO_COLOR: '1',
    CLICOLOR: '0',
    GH_PROMPT_DISABLED: '1',
    WRANGLER_SEND_METRICS: 'false',
  }
}

/**
 * Resolve a tool to an absolute executable path.
 *
 * @param {'gh'|'wrangler'|'ssh'} name
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ installed: boolean, path: string, error: string }}
 */
export function resolveExecutable(name, env = process.env) {
  const overrideKey = OVERRIDES[name]
  const configured = overrideKey ? env[overrideKey] : ''
  if (typeof configured === 'string' && configured.trim() !== '') {
    const candidate = path.resolve(configured.trim())
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return { installed: true, path: candidate, error: '' }
    } catch {
      return { installed: false, path: candidate, error: `${overrideKey} 指向的文件不可执行` }
    }
  }

  const dirs = usablePath(env).split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const candidate = path.join(dir, name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return { installed: true, path: candidate, error: '' }
    } catch {
      // keep looking
    }
  }
  return { installed: false, path: '', error: `找不到 ${name}，请先安装或加入 PATH` }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * Run one tool.
 *
 * @param {'gh'|'wrangler'|'ssh'} name
 * @param {string[]} args
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @param {Record<string,string>} [options.env]
 * @param {string} [options.cwd]
 * @returns {Promise<{
 *   ok: boolean,
 *   installed: boolean,
 *   path: string,
 *   stdout: string,
 *   stderr: string,
 *   code: number|null,
 *   signal: string|null,
 *   durationMs: number,
 *   timedOut: boolean,
 *   aborted: boolean,
 *   error: string,
 * }>}
 */
export async function runCli(name, args, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15_000
  const resolved = resolveExecutable(name)
  if (!resolved.installed) {
    return {
      ok: false,
      installed: false,
      path: resolved.path,
      stdout: '',
      stderr: '',
      code: null,
      signal: null,
      durationMs: 0,
      timedOut: false,
      aborted: false,
      error: resolved.error,
    }
  }

  const started = Date.now()
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }

  return new Promise((resolve) => {
    let timedOut = false
    let aborted = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    const child = execFile(
      resolved.path,
      args,
      {
        cwd: options.cwd,
        env: childEnv(options.env),
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT,
        windowsHide: true,
        signal: controller.signal,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        clearTimeout(timer)
        if (options.signal) options.signal.removeEventListener('abort', onAbort)
        if (error?.name === 'AbortError') aborted = true
        const code = typeof error?.code === 'number' ? error.code : null
        resolve({
          ok: error === null,
          installed: true,
          path: resolved.path,
          stdout: text(stdout),
          stderr: text(stderr),
          code,
          signal: typeof error?.signal === 'string' ? error.signal : null,
          durationMs: Date.now() - started,
          timedOut,
          aborted,
          error: error === null ? '' : timedOut ? `命令超时（${timeoutMs}ms）` : aborted ? '命令已取消' : text(error.message) || '命令失败',
        })
      },
    )
    // Keep the child referenced only for the lifetime of this promise; the
    // callback owns completion.
    void child
  })
}

/**
 * Extract the first JSON object/array from command output. Some CLIs print a
 * banner or a warning before their JSON payload.
 *
 * @param {string} output
 * @returns {unknown|undefined}
 */
export function extractJson(output) {
  const body = text(output).trim()
  if (body === '') return undefined
  const candidates = [body]
  const objectAt = body.indexOf('{')
  const arrayAt = body.indexOf('[')
  const start = objectAt === -1 ? arrayAt : arrayAt === -1 ? objectAt : Math.min(objectAt, arrayAt)
  if (start > 0) candidates.push(body.slice(start))
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // try the next candidate
    }
  }
  return undefined
}

/**
 * Short, user-facing command failure text without dumping full output.
 * @param {{ error: string, stderr: string, code: number|null }} result
 * @param {string} [fallback]
 * @returns {string}
 */
export function commandFailure(result, fallback = '命令执行失败') {
  const stderr = text(result?.stderr).trim()
  const first = stderr.split(/\r?\n/u).find((line) => line.trim() !== '')
  if (first) return first.slice(0, 300)
  if (text(result?.error) !== '') return text(result.error).slice(0, 300)
  return `${fallback}${result?.code == null ? '' : `（exit ${result.code}）`}`
}
