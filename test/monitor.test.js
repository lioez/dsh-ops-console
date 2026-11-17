import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'

import { createMonitor } from '../src/monitor.js'
import { createStore } from '../src/state.js'

let dir
let server
let base
let store
let monitor

function json(status, body) {
  return { status, headers: new Headers(), async json() { return body } }
}

function mockFetch() {
  return async (url, init) => {
    if (String(url).includes('/v1/limits')) {
      return json(200, { rateLimit: { measurements: { create: { limit: 250, remaining: 200, reset: 1800 } } } })
    }
    if (init?.method === 'POST') {
      return json(200, { id: 'm1', probesCount: 2 })
    }
    return json(200, {
      status: 'finished',
      results: [
        {
          probe: { country: 'CN', city: 'Shanghai', network: 'CN' },
          result: { status: 'finished', statusCode: 200, timings: { total: 100, firstByte: 80 } },
        },
        {
          probe: { country: 'US', city: 'Buffalo', network: 'US' },
          result: { status: 'finished', statusCode: 200, timings: { total: 200, firstByte: 180 } },
        },
      ],
    })
  }
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ops-monitor-'))
  store = createStore({ dataDir: dir })
  await store.load()
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}/`
  monitor = createMonitor({ store, fetchImpl: mockFetch() })
})

afterEach(async () => {
  await monitor.stop()
  await new Promise((resolve) => server.close(resolve))
  await fs.rm(dir, { recursive: true, force: true })
})

async function addSite(url = base) {
  const site = {
    id: 'site_1',
    name: 'Local',
    url,
    host: '127.0.0.1',
    enabled: true,
    createdAt: 1,
  }
  await store.updateConfig((draft) => {
    draft.sites.push(site)
  })
  return site
}

test('checkSite runs local and Globalping probes and persists history', async () => {
  const site = await addSite()
  const result = await monitor.checkSite(site)
  assert.equal(result.ok, true)
  assert.equal(result.last.status, 'up')
  assert.equal(result.last.local.status, 200)
  assert.equal(result.last.cn.medianMs, 100)
  assert.equal(result.last.global.medianMs, 200)

  const cached = store.getCache().sites[site.id]
  assert.equal(cached.history.length, 1)
  assert.equal(cached.history[0].status, 'up')
  assert.equal(monitor.pending().sites.length, 0)
})

test('a failed site is recorded as down', async () => {
  const site = await addSite('http://127.0.0.1:1/')
  const result = await monitor.checkSite(site)
  assert.equal(result.ok, true)
  assert.equal(result.last.status, 'down')
  assert.equal(store.getCache().sites[site.id].history[0].status, 'down')
})

test('the Globalping budget is respected', async () => {
  const site = await addSite()
  // Seed a low quota; the local probe must still run.
  await store.updateCache((draft) => {
    draft.globalping = { remaining: 1, limit: 250, resetIn: 100, fetchedAt: Date.now(), cooldownUntil: null, error: null }
  })
  const result = await monitor.checkSite(site)
  assert.equal(result.ok, true)
  assert.equal(result.last.cn.skipped, true)
  assert.equal(result.last.local.status, 200)
})

test('a Globalping API failure is stored and surfaced as a reason', async () => {
  const site = await addSite()
  const failing = createMonitor({
    store,
    fetchImpl: async (url, init) => {
      if (String(url).includes('/v1/limits')) {
        return json(200, { rateLimit: { measurements: { create: { limit: 250, remaining: 200, reset: 1800 } } } })
      }
      return json(500, { error: { message: 'upstream broke' } })
    },
  })
  const result = await failing.checkSite(site)
  assert.equal(result.ok, true)
  assert.equal(result.last.local.status, 200)
  assert.equal(result.last.error.code, 'globalping_error')
  assert.ok(result.last.reasons.some((line) => line.includes('upstream broke')))
  await failing.stop()
})

test('an aborted check leaves the previous cache untouched', async () => {
  const site = await addSite()
  const pending = monitor.checkSite(site)
  await monitor.stop()
  const result = await pending
  assert.equal(result.cancelled, true)
  assert.equal(store.getCache().sites[site.id], undefined)
})
