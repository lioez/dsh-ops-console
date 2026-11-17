import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'

import { buildRoutes } from '../src/routes.js'
import { createStore } from '../src/state.js'

let dir
let store
let calls
let monitor

function fakeMonitor() {
  return {
    validateRepo: async () => ({ ok: true, error: null }),
    checkSite: async (site) => calls.push(`site:${site.id}`),
    checkAllSites: async () => calls.push('sites:all'),
    checkServer: async (server, options = {}) => calls.push(`server:${server.id}:${options.password ? 'password' : 'key'}`),
    checkAllServers: async () => calls.push('servers:all'),
    refreshGithub: async () => calls.push('github:refresh'),
    refreshCloudflare: async () => calls.push('cloudflare:refresh'),
    refreshConnections: async () => calls.push('connections:refresh'),
    reschedule: async () => calls.push('reschedule'),
    pending: () => ({ sites: [], servers: [], github: false, cloudflare: false, connections: false }),
    tools: () => ({ ssh: { installed: true }, gh: { installed: true }, wrangler: { installed: true } }),
    running: () => false,
  }
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ops-routes-'))
  store = createStore({ dataDir: dir })
  await store.load()
  calls = []
  monitor = fakeMonitor()
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

function actionRoute() {
  return buildRoutes({ store, monitor, version: '0.3.0' })[1]
}

async function action(body) {
  const response = await actionRoute().fetch(new Request('http://localhost/api/ops-console/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
  return { status: response.status, body: await response.json() }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('snapshot route returns a complete empty shape', async () => {
  const route = buildRoutes({ store, monitor, version: '0.3.0' })[0]
  const response = await route.fetch(new Request('http://localhost/api/ops-console/snapshot'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.plugin.version, '0.3.0')
  assert.deepEqual(body.sites, [])
  assert.deepEqual(body.servers, [])
  assert.equal(body.github.state, 'idle')
  assert.equal(body.cloudflare.catalog.length, 0)
})

test('site add, duplicate rejection and removal', async () => {
  const added = await action({ type: 'site.add', name: 'Example', url: 'example.com' })
  assert.equal(added.status, 200)
  assert.equal(added.body.ok, true)
  assert.equal(store.getConfig().sites.length, 1)
  await tick()
  assert.equal(calls.some((line) => line.startsWith('site:')), true)

  const duplicate = await action({ type: 'site.add', url: 'https://example.com/' })
  assert.equal(duplicate.status, 409)

  const id = added.body.id
  const removed = await action({ type: 'site.remove', id })
  assert.equal(removed.status, 200)
  assert.equal(store.getConfig().sites.length, 0)
})

test('server add validates and starts a check', async () => {
  const bad = await action({ type: 'server.add', target: '-oProxyCommand=bad' })
  assert.equal(bad.status, 400)
  const added = await action({ type: 'server.add', label: 'Tokyo', target: 'vps01', user: 'root', port: 22 })
  assert.equal(added.status, 200)
  assert.equal(store.getConfig().servers.length, 1)
  await tick()
  assert.equal(calls.some((line) => line.startsWith('server:')), true)
})

test('server update edits user and key and only passes a one-time password to the check', async () => {
  const added = await action({ type: 'server.add', label: 'old', target: 'vps01', user: 'root', port: 22 })
  const id = added.body.id
  const updated = await action({
    type: 'server.update',
    id,
    label: 'new',
    target: 'vps02',
    user: 'deploy',
    port: 2222,
    identityFile: '~/.ssh/id_ed25519',
    password: 'one-time-secret',
  })
  assert.equal(updated.status, 200)
  const server = store.getConfig().servers[0]
  assert.equal(server.label, 'new')
  assert.equal(server.target, 'vps02')
  assert.equal(server.user, 'deploy')
  assert.equal(server.port, 2222)
  assert.equal(server.identityFile, '~/.ssh/id_ed25519')
  assert.equal(JSON.stringify(store.getConfig()).includes('one-time-secret'), false)
  await tick()
  assert.equal(calls.at(-1), `server:${id}:password`)

  await action({ type: 'server.add', target: 'vps09', user: 'root', port: 22 })
  const duplicate = await action({ type: 'server.update', id, target: 'vps09', user: 'root', port: 22 })
  assert.equal(duplicate.status, 409)
})

test('settings save reschedules and rejects bad values', async () => {
  const saved = await action({ type: 'settings.save', settings: { intervalMinutes: 30, globalCountries: ['US'] } })
  assert.equal(saved.status, 200)
  assert.equal(store.getConfig().settings.intervalMinutes, 30)
  assert.equal(calls.includes('reschedule'), true)

  const bad = await action({ type: 'settings.save', settings: { intervalMinutes: 1 } })
  assert.equal(bad.status, 400)
})

test('GitHub repo add validates through the monitor', async () => {
  const added = await action({ type: 'github.repo.add', repo: 'lioez/site' })
  assert.equal(added.status, 200)
  assert.equal(store.getConfig().github.repos.length, 1)
  await tick()
  assert.equal(calls.includes('github:refresh'), true)

  monitor.validateRepo = async () => ({ ok: false, error: { code: 'repo_invalid', message: 'no access', hint: 'check it' } })
  const bad = await action({ type: 'github.repo.add', repo: 'lioez/other' })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.error.hint, 'check it')
})

test('Cloudflare project add requires a discovered catalog entry', async () => {
  const missing = await action({ type: 'cloudflare.project.add', project: 'site' })
  assert.equal(missing.status, 409)
  await store.updateCache((draft) => {
    draft.cloudflare.catalog = [{ project: 'site', domains: ['site.pages.dev'] }]
  })
  const added = await action({ type: 'cloudflare.project.add', project: 'site' })
  assert.equal(added.status, 200)
  assert.equal(store.getConfig().cloudflare.projects.length, 1)
  await tick()
  assert.equal(calls.includes('cloudflare:refresh'), true)
})

test('cache clear keeps configuration but removes history', async () => {
  await action({ type: 'site.add', url: 'example.com' })
  await store.updateCache((draft) => {
    const id = store.getConfig().sites[0].id
    draft.sites[id] = { last: { status: 'up' }, history: [{ at: 1, status: 'up' }] }
  })
  const cleared = await action({ type: 'cache.clear', what: 'history' })
  assert.equal(cleared.status, 200)
  const id = store.getConfig().sites[0].id
  assert.deepEqual(store.getCache().sites[id].history, [])

  const all = await action({ type: 'cache.clear', what: 'all' })
  assert.equal(all.status, 200)
  assert.deepEqual(store.getCache().sites, {})
})

test('unknown and malformed actions are rejected without throwing', async () => {
  const unknown = await action({ type: 'nope' })
  assert.equal(unknown.status, 400)
  const malformed = await actionRoute().fetch(new Request('http://localhost/api/ops-console/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad',
  }))
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).ok, false)
})
