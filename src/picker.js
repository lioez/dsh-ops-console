/**
 * Native private-key picker.
 *
 * Browser file inputs never expose an absolute path, so a key chosen there
 * cannot be passed to `ssh -i`. On macOS the Host opens the system file chooser
 * through `osascript` and returns only the selected path. No key contents are
 * read, copied or stored.
 *
 * @module dsh-ops-console/src/picker
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

/** AppleScript for one file chooser, starting at the user's home folder. */
export const PICK_KEY_SCRIPT =
  'POSIX path of (choose file with prompt "选择 SSH 私钥" default location (path to home folder))'

/**
 * @param {string} file
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, code: number|null, error: string, timedOut: boolean }>}
 */
function runOsa(file, args, timeoutMs) {
  return new Promise((resolve) => {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
    }, timeoutMs)
    execFile(file, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
      windowsHide: true,
    }, (error, stdout, stderr) => {
      clearTimeout(timer)
      const code = typeof error?.code === 'number' ? error.code : null
      resolve({
        ok: error === null,
        stdout: typeof stdout === 'string' ? stdout : '',
        stderr: typeof stderr === 'string' ? stderr : '',
        code,
        error: error === null ? '' : timedOut ? `文件选择器超时（${timeoutMs}ms）` : String(error.message || error),
        timedOut,
      })
    })
  })
}

/**
 * Open the native file chooser and return the selected absolute path.
 *
 * @param {object} [options]
 * @param {string} [options.platform] defaults to process.platform.
 * @param {number} [options.timeoutMs]
 * @param {Function} [options.run] injected runner for tests.
 * @returns {Promise<{ ok: boolean, path?: string, code?: string, message?: string, hint?: string }>}
 */
export async function pickPrivateKey(options = {}) {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') {
    return {
      ok: false,
      code: 'unsupported',
      message: '当前系统没有内置的原生文件选择器',
      hint: '请手动填写私钥路径（例如 ~/.ssh/id_ed25519）。',
    }
  }

  const run = options.run ?? runOsa
  let result
  try {
    result = await run('osascript', ['-e', PICK_KEY_SCRIPT], options.timeoutMs ?? 180_000)
  } catch (error) {
    return {
      ok: false,
      code: 'picker_failed',
      message: String(error?.message ?? error).slice(0, 300),
      hint: '请手动填写私钥路径。',
    }
  }

  if (!result.ok) {
    const stderr = String(result.stderr ?? '')
    if (/User canceled|-128/iu.test(stderr)) {
      return { ok: false, code: 'cancelled', message: '已取消选择' }
    }
    return {
      ok: false,
      code: 'picker_failed',
      message: result.timedOut ? '文件选择器超时' : (stderr.trim().split(/\r?\n/u)[0] || result.error || '文件选择器失败').slice(0, 300),
      hint: '请重试，或手动填写私钥路径。',
    }
  }

  const selected = String(result.stdout ?? '').trim()
  if (selected === '' || !path.isAbsolute(selected) || /[\0\r\n]/u.test(selected) || selected.length > 4096) {
    return { ok: false, code: 'invalid_path', message: '文件选择器没有返回有效的绝对路径', hint: '请手动填写私钥路径。' }
  }
  try {
    const stat = await fs.stat(selected)
    if (!stat.isFile()) {
      return { ok: false, code: 'not_a_file', message: '选择的路径不是普通文件', hint: '请选择 SSH 私钥文件。' }
    }
  } catch (error) {
    return { ok: false, code: 'not_found', message: '选择的文件无法访问', hint: String(error?.message ?? error).slice(0, 200) }
  }
  return { ok: true, path: selected }
}
