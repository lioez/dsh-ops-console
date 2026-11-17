import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'

import { createStore, emptyCache, normalizeCache } from '../src/state.js'

let dir

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ops-state-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

test('a fresh store creates defaults and reloads them', async () => {
  const store = createStore({ dataDir: dir })
  const loaded = await store.load()
  assert.equal(loaded.config.version, 1)
  assert.deepEqual(loaded.config.sites, [])
  assert.equal(loaded.config.settings.intervalMinutes, 15)

  await store.updateConfig((draft) => {
    draft.sites.push({
      id: 'site_1',
      name: 'Example',
      url: 'https://example.com/',
      host: 'example.com',
      enabled: true,
      createdAt: 1,
    })
  })
  await store.flush()

  const again = createStore({ dataDir: dir })
  const reloaded = await again.load()
  assert.equal(reloaded.config.sites.length, 1)
  assert.equal(reloaded.config.sites[0].name, 'Example')
  const mode = (await fs.stat(path.join(dir, 'config.json'))).mode & 0o777
  assert.equal(mode, 0o600)
})

test('cache normalizes catalogs, history and unknown fields', () => {
  const cache = normalizeCache({
    sites: {
      site_1: { last: { status: 'up' }, history: [{ at: 1 }, { at: 2 }], junk: true },
    },
    cloudflare: {
      catalog: [{ project: 'a', domains: ['a.pages.dev'] }],
      projects: { cf_a: { project: 'a' } },
      version: '4.0.0',
    },
    unknown: 'dropped',
  })
  assert.equal(cache.sites.site_1.history.length, 2)
  assert.equal(cache.sites.site_1.junk, undefined)
  assert.equal(cache.cloudflare.catalog[0].project, 'a')
  assert.equal(cache.cloudflare.version, '4.0.0')
  assert.equal(cache.unknown, undefined)
})

test('a corrupt file is moved aside and defaults are restored', async () => {
  await fs.writeFile(path.join(dir, 'config.json'), '{not json', 'utf8')
  const warnings = []
  const logger = { warn: (...args) => warnings.push(args.join(' ')) }
  const store = createStore({ dataDir: dir, logger })
  const loaded = await store.load()
  assert.equal(loaded.config.version, 1)
  assert.ok(warnings.some((line) => line.includes('corrupt')))
  const files = await fs.readdir(dir)
  assert.ok(files.some((name) => name.startsWith('config.json.corrupt-')))
})

test('empty cache has every field the snapshot expects', () => {
  const cache = emptyCache()
  assert.deepEqual(cache.sites, {})
  assert.deepEqual(cache.cloudflare.catalog, [])
  assert.equal(cache.github.state, 'idle')
  assert.equal(cache.monitor.lastError, null)
})
