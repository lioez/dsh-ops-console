/**
 * Filesystem locations owned by dsh-ops-console.
 *
 * All state is plugin-owned and lives beside the profile under
 * `$DSH_HOME/ops-console`. `OPS_CONSOLE_HOME` exists so tests and local
 * development can point at a throwaway directory without touching the
 * user's real configuration.
 *
 * @module dsh-ops-console/src/paths
 */

import os from 'node:os'
import path from 'node:path'

/** Directory name under `$DSH_HOME`. */
const DATA_DIR_NAME = 'ops-console'

/**
 * Resolve the DSH home directory.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} absolute directory.
 */
export function resolveDshHome(env = process.env) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (configured !== '') return path.resolve(configured)
  return path.join(os.homedir(), '.dsh')
}

/**
 * Resolve the plugin's data directory.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} absolute directory.
 */
export function resolveDataDir(env = process.env) {
  const override = typeof env.OPS_CONSOLE_HOME === 'string' ? env.OPS_CONSOLE_HOME.trim() : ''
  if (override !== '') return path.resolve(override)
  return path.join(resolveDshHome(env), DATA_DIR_NAME)
}

/**
 * Expand a leading `~` in a user-supplied path.
 * @param {string} value path as typed.
 * @returns {string} expanded path.
 */
export function expandHome(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2))
  return trimmed
}
