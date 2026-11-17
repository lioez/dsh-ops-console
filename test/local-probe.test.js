import assert from 'node:assert/strict'
import http from 'node:http'
import { afterEach, test } from 'node:test'

import { probeLocal } from '../src/probes/local-http.js'

const servers = []

async function start(handler) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const { port } = server.address()
  return `http://127.0.0.1:${port}`
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

test('a local 200 response carries timings and status', async () => {
  const base = await start((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('hello')
  })
  const result = await probeLocal(`${base}/`)
  assert.equal(result.ok, true)
  assert.equal(result.reachable, true)
  assert.equal(result.status, 200)
  assert.equal(result.bodyBytes, 5)
  assert.ok(result.timings.totalMs >= 0)
  assert.equal(typeof result.timings.dnsMs, 'number')
  assert.equal(result.error, null)
})

test('redirects are followed and recorded', async () => {
  const base = await start((req, res) => {
    if (req.url === '/go') {
      res.writeHead(302, { location: '/final' })
      res.end()
      return
    }
    res.writeHead(200)
    res.end('ok')
  })
  const result = await probeLocal(`${base}/go`)
  assert.equal(result.ok, true)
  assert.equal(result.status, 200)
  assert.equal(result.redirects.length, 1)
  assert.equal(result.redirects[0].status, 302)
  assert.ok(result.finalUrl.endsWith('/final'))
})

test('an HTTP error is reachable but not ok', async () => {
  const base = await start((req, res) => {
    res.writeHead(503)
    res.end('busy')
  })
  const result = await probeLocal(`${base}/`)
  assert.equal(result.reachable, true)
  assert.equal(result.ok, false)
  assert.equal(result.status, 503)
  assert.equal(result.error.code, 'HTTP_STATUS')
})

test('a timeout returns a structured error', async () => {
  const base = await start(() => {
    // Deliberately never respond.
  })
  const result = await probeLocal(`${base}/`, { timeoutMs: 250 })
  assert.equal(result.ok, false)
  assert.equal(result.reachable, false)
  assert.ok(['ETIMEDOUT', 'ABORT_ERR'].includes(result.error.code), result.error.code)
})

test('large bodies are truncated', async () => {
  const base = await start((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('x'.repeat(20_000))
  })
  const result = await probeLocal(`${base}/`, { maxBodyBytes: 512 })
  assert.equal(result.ok, true)
  assert.equal(result.truncated, true)
  assert.ok(result.bodyBytes >= 512)
})

test('an unreachable port returns a connection error', async () => {
  // Bind a server, close it, and use its now-free port.
  const server = http.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  const result = await probeLocal(`http://127.0.0.1:${port}/`, { timeoutMs: 800 })
  assert.equal(result.ok, false)
  assert.equal(result.reachable, false)
  assert.ok(result.error.code, 'error code should be present')
})
