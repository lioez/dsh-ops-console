/**
 * Plugin-owned persistence.
 *
 * The console's watchlist and history are not DSH profile configuration:
 * writing them here never edits the profile patch, never restarts the plugin,
 * and never touches another plugin's rows. Two JSON files live under
 * `$DSH_HOME/ops-console` and are replaced atomically.
 *
 * @module dsh-ops-console/src/state
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import { describeError } from './log.js'
import { emptyConfig, normalizeConfig } from './validation.js'

/** Empty cache shape. */
export function emptyCache() {
  return {
    version: 1,
    savedAt: 0,
    sites: {},
    servers: {},
    github: {
      state: 'idle',
      account: null,
      version: '',
      error: null,
      lastFetchedAt: 0,
      repos: {},
    },
    cloudflare: {
      state: 'idle',
      account: null,
      accounts: [],
      permissionsCount: 0,
      version: '',
      error: null,
      lastFetchedAt: 0,
      projects: {},
      catalog: [],
    },
    globalping: {
      remaining: null,
      limit: null,
      resetIn: null,
      fetchedAt: 0,
      cooldownUntil: null,
      error: null,
    },
    monitor: {
      lastRunAt: 0,
      nextRunAt: 0,
      lastError: null,
    },
  }
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
 * @param {number} max
 * @returns {Array<object>}
 */
function historyOf(value, max = 200) {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(-max)
}

/**
 * Normalize a cache read from disk. Missing fields are repaired; unknown
 * fields are dropped so a future version cannot bloat the file forever.
 *
 * @param {unknown} raw
 * @returns {object}
 */
export function normalizeCache(raw) {
  const cache = emptyCache()
  if (!isRecord(raw)) return cache
  cache.savedAt = Number.isFinite(raw.savedAt) ? raw.savedAt : 0

  if (isRecord(raw.sites)) {
    for (const [id, value] of Object.entries(raw.sites)) {
      if (typeof id !== 'string' || id === '' || !isRecord(value)) continue
      cache.sites[id] = {
        last: isRecord(value.last) ? value.last : null,
        history: historyOf(value.history),
      }
    }
  }
  if (isRecord(raw.servers)) {
    for (const [id, value] of Object.entries(raw.servers)) {
      if (typeof id !== 'string' || id === '' || !isRecord(value)) continue
      cache.servers[id] = {
        last: isRecord(value.last) ? value.last : null,
        history: historyOf(value.history),
      }
    }
  }

  if (isRecord(raw.github)) {
    cache.github.state = typeof raw.github.state === 'string' ? raw.github.state : 'idle'
    cache.github.account = isRecord(raw.github.account) ? raw.github.account : null
    cache.github.version = typeof raw.github.version === 'string' ? raw.github.version : ''
    cache.github.error = typeof raw.github.error === 'string' ? raw.github.error : null
    cache.github.lastFetchedAt = Number.isFinite(raw.github.lastFetchedAt) ? raw.github.lastFetchedAt : 0
    if (isRecord(raw.github.repos)) {
      for (const [id, value] of Object.entries(raw.github.repos)) {
        if (typeof id === 'string' && isRecord(value)) cache.github.repos[id] = value
      }
    }
  }

  if (isRecord(raw.cloudflare)) {
    cache.cloudflare.state = typeof raw.cloudflare.state === 'string' ? raw.cloudflare.state : 'idle'
    cache.cloudflare.account = isRecord(raw.cloudflare.account) ? raw.cloudflare.account : null
    cache.cloudflare.accounts = Array.isArray(raw.cloudflare.accounts) ? raw.cloudflare.accounts.filter(isRecord) : []
    cache.cloudflare.permissionsCount = Number.isFinite(raw.cloudflare.permissionsCount) ? raw.cloudflare.permissionsCount : 0
    cache.cloudflare.version = typeof raw.cloudflare.version === 'string' ? raw.cloudflare.version : ''
    cache.cloudflare.error = typeof raw.cloudflare.error === 'string' ? raw.cloudflare.error : null
    cache.cloudflare.lastFetchedAt = Number.isFinite(raw.cloudflare.lastFetchedAt) ? raw.cloudflare.lastFetchedAt : 0
    if (isRecord(raw.cloudflare.projects)) {
      for (const [id, value] of Object.entries(raw.cloudflare.projects)) {
        if (typeof id === 'string' && isRecord(value)) cache.cloudflare.projects[id] = value
      }
    }
    cache.cloudflare.catalog = Array.isArray(raw.cloudflare.catalog) ? raw.cloudflare.catalog.filter(isRecord) : []
  }

  if (isRecord(raw.globalping)) {
    cache.globalping = {
      remaining: Number.isFinite(raw.globalping.remaining) ? raw.globalping.remaining : null,
      limit: Number.isFinite(raw.globalping.limit) ? raw.globalping.limit : null,
      resetIn: Number.isFinite(raw.globalping.resetIn) ? raw.globalping.resetIn : null,
      fetchedAt: Number.isFinite(raw.globalping.fetchedAt) ? raw.globalping.fetchedAt : 0,
      cooldownUntil: Number.isFinite(raw.globalping.cooldownUntil) ? raw.globalping.cooldownUntil : null,
      error: typeof raw.globalping.error === 'string' ? raw.globalping.error : null,
    }
  }

  if (isRecord(raw.monitor)) {
    cache.monitor = {
      lastRunAt: Number.isFinite(raw.monitor.lastRunAt) ? raw.monitor.lastRunAt : 0,
      nextRunAt: Number.isFinite(raw.monitor.nextRunAt) ? raw.monitor.nextRunAt : 0,
      lastError: typeof raw.monitor.lastError === 'string' ? raw.monitor.lastError : null,
    }
  }

  return cache
}

/**
 * Atomic JSON write. The temporary file is created next to the destination so
 * `rename` stays on one filesystem.
 *
 * @param {string} target absolute file path.
 * @param {unknown} value JSON-serializable value.
 * @returns {Promise<void>}
 */
async function writeJsonAtomic(target, value) {
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  const body = `${JSON.stringify(value, null, 2)}\n`
  try {
    await fs.writeFile(temp, body, { mode: 0o600 })
    await fs.rename(temp, target)
    try {
      await fs.chmod(target, 0o600)
    } catch {
      // A filesystem without POSIX modes is still usable.
    }
  } catch (error) {
    try {
      await fs.rm(temp, { force: true })
    } catch {
      // ignore cleanup failure
    }
    throw error
  }
}

/**
 * @param {string} dataDir
 * @param {string} name
 * @returns {string}
 */
function fileOf(dataDir, name) {
  return path.join(dataDir, name)
}

/**
 * @param {string} dataDir
 * @param {string} file
 * @param {any} logger
 * @returns {Promise<{ value: unknown, corruptPath?: string }>}
 */
async function readJsonOrNull(dataDir, file, logger) {
  try {
    const body = await fs.readFile(file, 'utf8')
    if (body.trim() === '') return { value: null }
    return { value: JSON.parse(body) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { value: null }
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
    const corrupt = `${file}.corrupt-${stamp}`
    try {
      await fs.rename(file, corrupt)
      logger?.warn?.('moved corrupt state file %s -> %s: %s', path.basename(file), path.basename(corrupt), describeError(error))
      return { value: null, corruptPath: corrupt }
    } catch (renameError) {
      logger?.warn?.('cannot read or move %s: %s; %s', path.basename(file), describeError(error), describeError(renameError))
      return { value: null }
    }
  }
}

/**
 * Create the store for one plugin instance.
 *
 * @param {object} options
 * @param {string} options.dataDir absolute data directory.
 * @param {any} [options.logger]
 */
export function createStore({ dataDir, logger }) {
  if (typeof dataDir !== 'string' || dataDir === '') throw new Error('dataDir is required')
  const configPath = fileOf(dataDir, 'config.json')
  const cachePath = fileOf(dataDir, 'cache.json')

  let config = emptyConfig()
  let cache = emptyCache()
  let loaded = false
  let writeChain = Promise.resolve()

  /**
   * Serialize writes. A failed write never poisons the next one.
   * @param {() => Promise<void>} task
   * @returns {Promise<void>}
   */
  function enqueue(task) {
    const run = () => task()
    const result = writeChain.then(run, run)
    writeChain = result.catch(() => {})
    return result
  }

  async function load() {
    if (loaded) return { config, cache }
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 })
    try {
      await fs.chmod(dataDir, 0o700)
    } catch {
      // best effort
    }

    const configRead = await readJsonOrNull(dataDir, configPath, logger)
    const cacheRead = await readJsonOrNull(dataDir, cachePath, logger)
    config = normalizeConfig(configRead.value)
    cache = normalizeCache(cacheRead.value)
    loaded = true

    // Materialize defaults on first load so the settings page can show a
    // stable path immediately. Cache is written lazily; it is derived data.
    if (configRead.value === null) {
      try {
        await writeJsonAtomic(configPath, config)
      } catch (error) {
        logger?.warn?.('cannot create default config: %s', describeError(error))
      }
    }
    if (cacheRead.value === null) {
      try {
        await writeJsonAtomic(cachePath, cache)
      } catch (error) {
        logger?.warn?.('cannot create default cache: %s', describeError(error))
      }
    }
    return { config, cache }
  }

  function ensureLoaded() {
    if (!loaded) throw new Error('store.load() must be called before use')
  }

  function getConfig() {
    ensureLoaded()
    return config
  }

  function getCache() {
    ensureLoaded()
    return cache
  }

  /**
   * Clone, mutate and persist config. The mutator must return the next config
   * or mutate the clone in place.
   * @param {(draft: object) => object|void} mutator
   * @returns {Promise<object>}
   */
  async function updateConfig(mutator) {
    ensureLoaded()
    const draft = structuredClone(config)
    const returned = await mutator(draft)
    config = normalizeConfig(returned ?? draft)
    await enqueue(() => writeJsonAtomic(configPath, config))
    return config
  }

  /**
   * Clone, mutate and persist cache.
   * @param {(draft: object) => object|void} mutator
   * @returns {Promise<object>}
   */
  async function updateCache(mutator) {
    ensureLoaded()
    const draft = structuredClone(cache)
    const returned = await mutator(draft)
    cache = normalizeCache(returned ?? draft)
    cache.savedAt = Date.now()
    await enqueue(() => writeJsonAtomic(cachePath, cache))
    return cache
  }

  /**
   * Persist a cache mutation without failing the caller when the disk is
   * read-only. Used by background checks, where a write problem must not turn
   * a successful probe into a user-visible error.
   * @param {(draft: object) => object|void} mutator
   * @returns {Promise<object>}
   */
  async function updateCacheBestEffort(mutator) {
    try {
      return await updateCache(mutator)
    } catch (error) {
      logger?.warn?.('cache write failed: %s', describeError(error))
      return cache
    }
  }

  async function flush() {
    await writeChain.catch(() => {})
  }

  return {
    dataDir,
    configPath,
    cachePath,
    load,
    getConfig,
    getCache,
    updateConfig,
    updateCache,
    updateCacheBestEffort,
    flush,
  }
}
