/**
 * Local HTTP(S) probe.
 *
 * This is the "from this Mac" half of a website check. It records the DNS,
 * TCP, TLS, first-byte and total timing, follows redirects manually, captures
 * certificate metadata, and never downloads more than a small body. It uses
 * only Node built-ins so it can be unit-tested without a browser or a build
 * step.
 *
 * @module dsh-ops-console/src/probes/local-http
 */

import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { performance } from 'node:perf_hooks'

/** Default per-check budget. */
export const LOCAL_TIMEOUT_MS = 15_000
/** Largest response body retained. */
export const LOCAL_MAX_BODY_BYTES = 256 * 1024
/** Redirect hops followed. */
export const LOCAL_MAX_REDIRECTS = 5

const USER_AGENT = 'dsh-ops-console/0.1'

/**
 * @param {number} ms
 * @returns {number}
 */
function round(ms) {
  return Number.isFinite(ms) ? Math.round(ms) : 0
}

/**
 * @param {unknown} error
 * @returns {{ code: string, message: string }}
 */
function errorInfo(error) {
  const code = typeof error?.code === 'string' ? error.code : typeof error?.code === 'number' ? String(error.code) : 'PROBE_ERROR'
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '探测失败'
  return { code, message: String(message).slice(0, 500) }
}

/**
 * Whether an error looks like certificate validation rather than a transport
 * failure. These are retried once without verification to read the cert.
 * @param {{ code: string, message: string }} info
 * @returns {boolean}
 */
function looksLikeTlsFailure(info) {
  const code = info.code.toUpperCase()
  const message = info.message.toLowerCase()
  return (
    code.startsWith('CERT_') ||
    code.startsWith('ERR_TLS') ||
    code.startsWith('ERR_SSL') ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'EPROTO' ||
    message.includes('certificate') ||
    message.includes('self signed') ||
    message.includes('self-signed') ||
    message.includes('tls')
  )
}

/**
 * @param {unknown} socket
 * @param {string} authorizationError
 * @returns {{ valid: boolean, daysLeft: number|null, protocol: string, issuer: string, error: string|null }}
 */
function readTls(socket, authorizationError = '') {
  let cert = {}
  try {
    cert = socket?.getPeerCertificate?.() ?? {}
  } catch {
    cert = {}
  }
  const validTo = typeof cert?.valid_to === 'string' ? Date.parse(cert.valid_to) : NaN
  const daysLeft = Number.isFinite(validTo) ? Math.floor((validTo - Date.now()) / 86_400_000) : null
  const issuer =
    (typeof cert?.issuer?.CN === 'string' && cert.issuer.CN) ||
    (typeof cert?.issuer?.O === 'string' && cert.issuer.O) ||
    ''
  let protocol = ''
  try {
    protocol = typeof socket?.getProtocol === 'function' ? socket.getProtocol() ?? '' : ''
  } catch {
    protocol = ''
  }
  return {
    valid: socket?.authorized === true && authorizationError === '',
    daysLeft,
    protocol,
    issuer: issuer.slice(0, 160),
    error: authorizationError === '' ? null : authorizationError.slice(0, 300),
  }
}

/**
 * Resolve the host once for the DNS timing. The HTTP client resolves
 * independently, but this gives a stable, observable number.
 *
 * @param {string} hostname
 * @param {number} timeoutMs
 * @returns {Promise<{ ms: number, addresses: string[], error: object|null }>}
 */
async function lookupHost(hostname, timeoutMs) {
  const started = performance.now()
  let timer
  try {
    const addresses = await Promise.race([
      dns.lookup(hostname, { all: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('DNS 解析超时'), { code: 'ETIMEDOUT' })), timeoutMs)
      }),
    ])
    return { ms: round(performance.now() - started), addresses: addresses.map((item) => item.address), error: null }
  } catch (error) {
    return { ms: round(performance.now() - started), addresses: [], error: errorInfo(error) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * One HTTP exchange. Never rejects; transport errors are returned.
 *
 * @param {URL} url
 * @param {object} options
 * @param {number} options.timeoutMs
 * @param {boolean} options.rejectUnauthorized
 * @param {AbortSignal} [options.signal]
 * @param {number} options.maxBodyBytes
 * @returns {Promise<object>}
 */
function requestOnce(url, options) {
  return new Promise((resolve) => {
    const started = performance.now()
    let connectedAt = 0
    let secureAt = 0
    let finished = false
    let timer
    let onAbort

    /** @param {object} value */
    const done = (value) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (options.signal && onAbort) options.signal.removeEventListener('abort', onAbort)
      resolve(value)
    }

    const startedError = (error) => {
      done({
        ok: false,
        reachable: false,
        status: null,
        statusText: '',
        headers: {},
        timings: {
          dnsMs: 0,
          tcpMs: connectedAt === 0 ? 0 : round(connectedAt - started),
          tlsMs: secureAt === 0 ? 0 : round(secureAt - connectedAt),
          ttfbMs: 0,
          totalMs: round(performance.now() - started),
        },
        tls: null,
        bodyBytes: 0,
        truncated: false,
        error: errorInfo(error),
      })
    }

    const transport = url.protocol === 'https:' ? https : http
    let req
    try {
      req = transport.request(
        url,
        {
          method: 'GET',
          agent: false,
          timeout: options.timeoutMs,
          rejectUnauthorized: options.rejectUnauthorized,
          headers: {
            'user-agent': USER_AGENT,
            accept: '*/*',
            'accept-encoding': 'identity',
            'cache-control': 'no-cache',
          },
        },
        (res) => {
          const ttfb = performance.now()
          let bodyBytes = 0
          let truncated = false
          const socket = res.socket
          const tls = url.protocol === 'https:' ? readTls(socket, socket?.authorizationError ?? '') : null
          const finish = () => {
            done({
              ok: true,
              reachable: true,
              status: res.statusCode ?? null,
              statusText: typeof res.statusMessage === 'string' ? res.statusMessage : '',
              headers: res.headers,
              location: typeof res.headers.location === 'string' ? res.headers.location : '',
              timings: {
                dnsMs: 0,
                tcpMs: connectedAt === 0 ? 0 : round(connectedAt - started),
                tlsMs: secureAt === 0 ? 0 : round(secureAt - connectedAt),
                ttfbMs: round(ttfb - started),
                totalMs: round(performance.now() - started),
              },
              tls,
              bodyBytes,
              truncated,
              error: null,
            })
          }

          res.on('data', (chunk) => {
            bodyBytes += chunk.length
            if (bodyBytes > options.maxBodyBytes) {
              truncated = true
              res.destroy()
              finish()
            }
          })
          res.on('end', finish)
          res.on('close', finish)
          res.on('error', finish)
        },
      )
    } catch (error) {
      startedError(error)
      return
    }

    req.on('socket', (socket) => {
      socket.once('connect', () => {
        connectedAt = performance.now()
      })
      if (url.protocol === 'https:') {
        socket.once('secureConnect', () => {
          secureAt = performance.now()
        })
      }
    })
    req.on('timeout', () => {
      req.destroy(Object.assign(new Error(`请求超时（${options.timeoutMs}ms）`), { code: 'ETIMEDOUT' }))
    })
    req.on('error', (error) => {
      if (finished) return
      done({
        ok: false,
        reachable: false,
        status: null,
        statusText: '',
        headers: {},
        timings: {
          dnsMs: 0,
          tcpMs: connectedAt === 0 ? 0 : round(connectedAt - started),
          tlsMs: secureAt === 0 ? 0 : round(secureAt - connectedAt),
          ttfbMs: 0,
          totalMs: round(performance.now() - started),
        },
        tls: url.protocol === 'https:' ? readTls(null, errorInfo(error).message) : null,
        bodyBytes: 0,
        truncated: false,
        error: errorInfo(error),
      })
    })

    if (options.signal) {
      onAbort = () => {
        req.destroy(Object.assign(new Error('探测已取消'), { code: 'ABORT_ERR' }))
      }
      if (options.signal.aborted) onAbort()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }

    timer = setTimeout(() => {
      req.destroy(Object.assign(new Error(`请求超时（${options.timeoutMs}ms）`), { code: 'ETIMEDOUT' }))
    }, options.timeoutMs)

    req.end()
  })
}

/**
 * Run one hop, retrying a certificate failure once without verification so
 * the console can still show the certificate and a useful reason.
 *
 * @param {URL} url
 * @param {{ timeoutMs: number, signal?: AbortSignal, maxBodyBytes: number }} options
 * @returns {Promise<object>}
 */
async function requestWithTlsDetail(url, options) {
  const first = await requestOnce(url, { ...options, rejectUnauthorized: true })
  if (first.ok || url.protocol !== 'https:' || !first.error || !looksLikeTlsFailure(first.error)) return first

  const retry = await requestOnce(url, { ...options, rejectUnauthorized: false })
  if (!retry.ok) return first
  return {
    ...retry,
    tls: {
      ...(retry.tls ?? { daysLeft: null, protocol: '', issuer: '' }),
      valid: false,
      error: first.error.message,
    },
  }
}

/**
 * Probe a URL from this machine.
 *
 * @param {string|URL} target
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxBodyBytes]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{
 *   ok: boolean,
 *   reachable: boolean,
 *   status: number|null,
 *   statusText: string,
 *   finalUrl: string,
 *   redirects: Array<object>,
 *   timings: { dnsMs: number, tcpMs: number, tlsMs: number, ttfbMs: number, totalMs: number },
 *   tls: object|null,
 *   bodyBytes: number,
 *   truncated: boolean,
 *   error: { code: string, message: string }|null,
 * }>}
 */
export async function probeLocal(target, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : LOCAL_TIMEOUT_MS
  const maxBodyBytes = Number.isFinite(options.maxBodyBytes) ? options.maxBodyBytes : LOCAL_MAX_BODY_BYTES
  const deadline = performance.now() + timeoutMs
  let current
  try {
    current = target instanceof URL ? new URL(target.toString()) : new URL(String(target))
  } catch {
    return {
      ok: false,
      reachable: false,
      status: null,
      statusText: '',
      finalUrl: String(target ?? ''),
      redirects: [],
      timings: { dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, totalMs: 0 },
      tls: null,
      bodyBytes: 0,
      truncated: false,
      error: { code: 'INVALID_URL', message: '站点地址不是合法 URL' },
    }
  }

  const dnsResult = await lookupHost(current.hostname, Math.max(1, Math.min(timeoutMs, 5_000)))
  if (dnsResult.error !== null) {
    return {
      ok: false,
      reachable: false,
      status: null,
      statusText: '',
      finalUrl: current.toString(),
      redirects: [],
      timings: { dnsMs: dnsResult.ms, tcpMs: 0, tlsMs: 0, ttfbMs: 0, totalMs: dnsResult.ms },
      tls: null,
      bodyBytes: 0,
      truncated: false,
      error: dnsResult.error,
    }
  }

  const redirects = []
  const totals = { dnsMs: dnsResult.ms, tcpMs: 0, tlsMs: 0, ttfbMs: 0, totalMs: 0 }

  for (let hop = 0; hop <= LOCAL_MAX_REDIRECTS; hop += 1) {
    if (options.signal?.aborted) {
      return {
        ok: false,
        reachable: false,
        status: null,
        statusText: '',
        finalUrl: current.toString(),
        redirects,
        timings: totals,
        tls: null,
        bodyBytes: 0,
        truncated: false,
        error: { code: 'ABORT_ERR', message: '探测已取消' },
      }
    }
    const remaining = Math.max(1, Math.floor(deadline - performance.now()))
    const result = await requestWithTlsDetail(current, {
      timeoutMs: Math.min(remaining, timeoutMs),
      maxBodyBytes,
      signal: options.signal,
    })
    totals.tcpMs += result.timings.tcpMs
    totals.tlsMs += result.timings.tlsMs
    totals.ttfbMs += result.timings.ttfbMs
    totals.totalMs += result.timings.totalMs

    if (!result.ok) {
      return {
        ...result,
        finalUrl: current.toString(),
        redirects,
        timings: { ...result.timings, dnsMs: dnsResult.ms, totalMs: totals.totalMs },
      }
    }

    const status = result.status ?? 0
    const location = result.location ?? ''
    if (status >= 300 && status < 400 && location !== '') {
      let next
      try {
        next = new URL(location, current)
      } catch {
        return {
          ...result,
          finalUrl: current.toString(),
          redirects,
          timings: { ...result.timings, dnsMs: dnsResult.ms, totalMs: totals.totalMs },
          ok: false,
          error: { code: 'BAD_REDIRECT', message: '重定向目标不是合法 URL' },
        }
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return {
          ...result,
          finalUrl: current.toString(),
          redirects,
          timings: { ...result.timings, dnsMs: dnsResult.ms, totalMs: totals.totalMs },
          ok: false,
          error: { code: 'BAD_REDIRECT', message: '重定向到了非 HTTP(S) 地址' },
        }
      }
      redirects.push({
        url: current.toString(),
        status,
        location: next.toString(),
        ms: result.timings.totalMs,
      })
      current = next
      continue
    }

    const ok = status >= 200 && status < 400
    return {
      ...result,
      ok,
      status,
      finalUrl: current.toString(),
      redirects,
      timings: {
        dnsMs: dnsResult.ms,
        tcpMs: totals.tcpMs,
        tlsMs: totals.tlsMs,
        ttfbMs: totals.ttfbMs,
        totalMs: totals.totalMs,
      },
      error: ok ? null : { code: 'HTTP_STATUS', message: `HTTP ${status}${result.statusText ? ` ${result.statusText}` : ''}` },
    }
  }

  return {
    ok: false,
    reachable: false,
    status: null,
    statusText: '',
    finalUrl: current.toString(),
    redirects,
    timings: totals,
    tls: null,
    bodyBytes: 0,
    truncated: false,
    error: { code: 'TOO_MANY_REDIRECTS', message: `超过 ${LOCAL_MAX_REDIRECTS} 次重定向` },
  }
}
