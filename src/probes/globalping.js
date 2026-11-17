/**
 * Globalping client.
 *
 * Globalping is a public, free measurement API backed by community probes.
 * The console uses its HTTP measurement type because it answers the question
 * that matters for a deployed site: "can people in mainland China and abroad
 * actually fetch this page, and how long does it take?"
 *
 * The API needs no key for the anonymous quota. The client stays conservative:
 * one measurement per site, a small number of probes, a budget check before a
 * run, and a cooldown when the API says no.
 *
 * @module dsh-ops-console/src/probes/globalping
 */

/** Public API origin. Overridable for tests. */
export const GLOBALPING_API = 'https://api.globalping.io'
/** Hard cap on probes for one measurement. */
export const GLOBALPING_MAX_PROBES = 8
const USER_AGENT = 'dsh-ops-console/0.1'

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    let timer
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(Object.assign(new Error('测量已取消'), { code: 'ABORT_ERR' }))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/**
 * @param {number} value
 * @returns {number}
 */
function round(value) {
  return Number.isFinite(value) ? Math.round(value) : 0
}

/**
 * Fetch JSON with a timeout and external cancellation.
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {{ timeoutMs: number, signal?: AbortSignal, fetchImpl?: typeof fetch }} options
 * @returns {Promise<{ status: number, body: any, headers: Headers }>}
 */
async function requestJson(url, init, options) {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const doFetch = options.fetchImpl ?? fetch
    const response = await doFetch(url, { ...init, signal: controller.signal })
    let body = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    return { status: response.status, body, headers: response.headers }
  } finally {
    clearTimeout(timer)
    if (options.signal) options.signal.removeEventListener('abort', onAbort)
  }
}

/**
 * @param {unknown} body
 * @returns {string}
 */
function apiError(body) {
  const message = body?.error?.message
  if (typeof message === 'string' && message.trim() !== '') return message.slice(0, 300)
  if (typeof body?.error === 'string') return body.error.slice(0, 300)
  return 'Globalping 请求失败'
}

/**
 * Build the measurement request body.
 *
 * @param {{ url: string }} site
 * @param {{ cnProbes?: number, globalCountries?: string[] }} settings
 * @returns {object}
 */
export function buildMeasurement(site, settings = {}) {
  const url = new URL(site.url)
  const cnProbes = Math.max(1, Math.min(3, Number(settings.cnProbes) || 2))
  const countries = Array.isArray(settings.globalCountries) && settings.globalCountries.length > 0
    ? settings.globalCountries
    : ['US', 'DE']
  const locations = [{ country: 'CN', limit: cnProbes }]
  for (const country of countries) {
    if (country === 'CN') continue
    locations.push({ country, limit: 1 })
    if (locations.length >= GLOBALPING_MAX_PROBES) break
  }
  const request = { method: 'GET', path: url.pathname || '/' }
  return {
    type: 'http',
    target: url.hostname,
    locations,
    measurementOptions: {
      protocol: url.protocol === 'https:' ? 'HTTPS' : 'HTTP',
      port: url.port === '' ? undefined : Number(url.port),
      request,
    },
  }
}

/**
 * Read the anonymous rate limit.
 *
 * @param {{ apiBase?: string, timeoutMs?: number, signal?: AbortSignal, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ remaining: number|null, limit: number|null, resetIn: number|null, fetchedAt: number, error: string|null }>}
 */
export async function fetchLimits(options = {}) {
  const apiBase = options.apiBase ?? GLOBALPING_API
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 8_000
  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const { status, body } = await requestJson(`${apiBase}/v1/limits`, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    }, { timeoutMs, signal: options.signal, fetchImpl })
    if (status < 200 || status >= 300) {
      return { remaining: null, limit: null, resetIn: null, fetchedAt: Date.now(), error: apiError(body) }
    }
    const create = body?.rateLimit?.measurements?.create
    return {
      remaining: Number.isFinite(create?.remaining) ? create.remaining : null,
      limit: Number.isFinite(create?.limit) ? create.limit : null,
      resetIn: Number.isFinite(create?.reset) ? create.reset : null,
      fetchedAt: Date.now(),
      error: null,
    }
  } catch (error) {
    return {
      remaining: null,
      limit: null,
      resetIn: null,
      fetchedAt: Date.now(),
      error: error?.name === 'AbortError' ? '读取 Globalping 额度超时' : String(error?.message ?? error).slice(0, 300),
    }
  }
}

/**
 * @param {{ probe?: object, result?: object }} item
 * @returns {object}
 */
function nodeOf(item) {
  const probe = item?.probe ?? {}
  const result = item?.result ?? {}
  const total = Number.isFinite(result?.timings?.total) ? result.timings.total : null
  const ok = result?.status === 'finished' && total !== null
  return {
    country: typeof probe.country === 'string' ? probe.country : '',
    city: typeof probe.city === 'string' ? probe.city : '',
    network: typeof probe.network === 'string' ? probe.network : '',
    asn: Number.isFinite(probe.asn) ? probe.asn : null,
    ok,
    totalMs: ok ? round(total) : null,
    ttfbMs: ok && Number.isFinite(result?.timings?.firstByte) ? round(result.timings.firstByte) : null,
    status: Number.isFinite(result?.statusCode) ? result.statusCode : null,
    error: ok ? null : String(result?.error ?? result?.status ?? '无结果').slice(0, 200),
  }
}

/**
 * @param {object[]} nodes
 * @returns {object}
 */
function summarize(nodes) {
  const ok = nodes.filter((node) => node.ok && node.totalMs !== null)
  const values = ok.map((node) => node.totalMs).sort((a, b) => a - b)
  const failures = nodes.filter((node) => !node.ok)
  const median = values.length === 0
    ? null
    : values.length % 2 === 1
      ? values[Math.floor(values.length / 2)]
      : Math.round((values[values.length / 2 - 1] + values[values.length / 2]) / 2)
  return {
    total: nodes.length,
    success: ok.length,
    failed: failures.length,
    medianMs: median,
    minMs: values.length > 0 ? values[0] : null,
    maxMs: values.length > 0 ? values[values.length - 1] : null,
    skipped: false,
    error: null,
    nodes,
    failures,
  }
}

/**
 * Split measurement results into mainland China and overseas groups.
 *
 * @param {Array<{ probe?: object, result?: object }>} results
 * @returns {{ cn: object, global: object }}
 */
export function groupResults(results) {
  const nodes = Array.isArray(results) ? results.map(nodeOf) : []
  const cn = nodes.filter((node) => node.country === 'CN')
  const global = nodes.filter((node) => node.country !== 'CN')
  return { cn: summarize(cn), global: summarize(global) }
}

/**
 * @param {object[]} results
 * @returns {{ message: string, code: string }|null}
 */
function firstFailure(results) {
  for (const item of Array.isArray(results) ? results : []) {
    const result = item?.result
    if (result?.status !== 'finished') {
      return {
        code: 'probe_failed',
        message: String(result?.error ?? (result?.status ? `节点状态 ${result.status}` : '探测无结果')).slice(0, 300),
      }
    }
  }
  return null
}

/**
 * Run one HTTP measurement for a site.
 *
 * @param {{ id: string, url: string, host?: string }} site
 * @param {object} [options]
 * @param {number} [options.cnProbes]
 * @param {string[]} [options.globalCountries]
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.apiBase]
 * @returns {Promise<{
 *   ok: boolean,
 *   measurementId: string|null,
 *   cn: object,
 *   global: object,
 *   probesCount: number,
 *   error: { code: string, message: string }|null,
 * }>}
 */
export async function probeGlobalping(site, options = {}) {
  const apiBase = options.apiBase ?? GLOBALPING_API
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30_000
  const signal = options.signal
  const payload = buildMeasurement(site, options)

  try {
    let created
    try {
      created = await requestJson(`${apiBase}/v1/measurements`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(payload),
      }, { timeoutMs: Math.min(15_000, timeoutMs), signal, fetchImpl })
    } catch (error) {
      return {
        ok: false,
        measurementId: null,
        cn: summarize([]),
        global: summarize([]),
        probesCount: 0,
        error: {
          code: error?.name === 'AbortError' ? 'timeout' : 'globalping_unreachable',
          message: error?.name === 'AbortError' ? '创建 Globalping 测量超时' : String(error?.message ?? error).slice(0, 300),
        },
      }
    }

    if (created.status === 429) {
      return {
        ok: false,
        measurementId: null,
        cn: summarize([]),
        global: summarize([]),
        probesCount: 0,
        error: { code: 'rate_limited', message: apiError(created.body) },
      }
    }
    if (created.status < 200 || created.status >= 300) {
      return {
        ok: false,
        measurementId: null,
        cn: summarize([]),
        global: summarize([]),
        probesCount: 0,
        error: { code: 'globalping_error', message: apiError(created.body) },
      }
    }

    const id = typeof created.body?.id === 'string' ? created.body.id : ''
    if (id === '') {
      return {
        ok: false,
        measurementId: null,
        cn: summarize([]),
        global: summarize([]),
        probesCount: 0,
        error: { code: 'globalping_error', message: 'Globalping 没有返回测量 ID' },
      }
    }

    const probesCount = Number.isFinite(created.body?.probesCount) ? created.body.probesCount : 0
    const deadline = Date.now() + timeoutMs
    let last = created.body
    while (Date.now() < deadline) {
      await delay(1_000, signal)
      let polled
      try {
        polled = await requestJson(`${apiBase}/v1/measurements/${encodeURIComponent(id)}`, {
          method: 'GET',
          headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        }, { timeoutMs: Math.min(8_000, Math.max(1, deadline - Date.now())), signal, fetchImpl })
      } catch (error) {
        if (error?.name === 'AbortError') {
          return {
            ok: false,
            measurementId: id,
            cn: summarize([]),
            global: summarize([]),
            probesCount,
            error: { code: 'timeout', message: '等待 Globalping 结果超时' },
          }
        }
        return {
          ok: false,
          measurementId: id,
          cn: summarize([]),
          global: summarize([]),
          probesCount,
          error: { code: 'globalping_error', message: String(error?.message ?? error).slice(0, 300) },
        }
      }
      if (polled.status === 429) {
        return {
          ok: false,
          measurementId: id,
          cn: summarize([]),
          global: summarize([]),
          probesCount,
          error: { code: 'rate_limited', message: apiError(polled.body) },
        }
      }
      if (polled.status < 200 || polled.status >= 300) {
        return {
          ok: false,
          measurementId: id,
          cn: summarize([]),
          global: summarize([]),
          probesCount,
          error: { code: 'globalping_error', message: apiError(polled.body) },
        }
      }
      last = polled.body
      if (last?.status === 'finished') break
    }

    const groups = groupResults(last?.results)
    const failure = firstFailure(last?.results)
    const finished = last?.status === 'finished'
    return {
      ok: finished && groups.cn.total + groups.global.total > 0,
      measurementId: id,
      cn: groups.cn,
      global: groups.global,
      probesCount,
      error: finished
        ? failure
        : { code: 'timeout', message: '等待 Globalping 结果超时，已返回部分结果' },
    }
  } catch (error) {
    return {
      ok: false,
      measurementId: null,
      cn: summarize([]),
      global: summarize([]),
      probesCount: 0,
      error: { code: 'globalping_error', message: String(error?.message ?? error).slice(0, 300) },
    }
  }
}
