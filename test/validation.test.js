import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ValidationError,
  createProject,
  createRepo,
  createServer,
  createSite,
  defaultSettings,
  normalizeConfig,
  normalizePort,
  normalizeProject,
  normalizeRepo,
  normalizeServerTarget,
  normalizeSettings,
  normalizeSiteUrl,
  CN_CITY_CHOICES,
  updateServer,
} from '../src/validation.js'

test('bare site URLs default to https and drop query/credentials', () => {
  assert.deepEqual(normalizeSiteUrl('example.com/a?token=1#x'), {
    url: 'https://example.com/a',
    host: 'example.com',
  })
  assert.throws(() => normalizeSiteUrl('ftp://example.com'), ValidationError)
  assert.throws(() => normalizeSiteUrl('https://user:pass@example.com'), ValidationError)
  assert.throws(() => normalizeSiteUrl('not a url'), ValidationError)
})

test('site names fall back to the host and are bounded', () => {
  const site = createSite({ url: 'https://example.com/' })
  assert.equal(site.name, 'example.com')
  assert.ok(site.id.startsWith('site_'))
  assert.throws(() => createSite({ url: 'https://example.com/', name: 'x'.repeat(81) }), ValidationError)
})

test('server target and port validation rejects option injection', () => {
  assert.equal(normalizeServerTarget('vps-1.example.com'), 'vps-1.example.com')
  assert.equal(normalizeServerTarget('[::1]'), '[::1]')
  assert.throws(() => normalizeServerTarget('-oProxyCommand=bad'), ValidationError)
  assert.throws(() => normalizeServerTarget('root@host'), ValidationError)
  assert.throws(() => normalizeServerTarget('host name'), ValidationError)
  assert.equal(normalizePort('2222'), 2222)
  assert.equal(normalizePort(''), null)
  assert.throws(() => normalizePort('70000'), ValidationError)

  const server = createServer({ label: 'Tokyo', target: 'tokyo', user: 'root', port: 22 })
  assert.equal(server.label, 'Tokyo')
  assert.equal(server.port, 22)
  assert.ok(server.id.startsWith('srv_'))
})

test('repo and project normalization', () => {
  assert.equal(normalizeRepo(' Lioez/MySite.git '), 'Lioez/MySite')
  assert.equal(normalizeRepo('https://github.com/lioez/my-site'), 'lioez/my-site')
  assert.throws(() => normalizeRepo('missing-owner'), ValidationError)
  assert.throws(() => normalizeRepo('owner/bad name'), ValidationError)
  assert.equal(normalizeProject('my-pages'), 'my-pages')
  assert.throws(() => normalizeProject('bad name'), ValidationError)
  assert.equal(createRepo('a/b').repo, 'a/b')
  assert.equal(createProject('my-pages').id, 'cf_my-pages')
})

test('settings clamp and validate', () => {
  const base = defaultSettings()
  const next = normalizeSettings({ intervalMinutes: 30, cnProbes: 3, globalCountries: ['US', 'JP', 'US'] }, base)
  assert.equal(next.intervalMinutes, 30)
  assert.equal(next.cnProbes, 3)
  assert.deepEqual(next.globalCountries, ['US', 'JP'])
  assert.throws(() => normalizeSettings({ intervalMinutes: 3 }, base), ValidationError)
  assert.throws(() => normalizeSettings({ globalCountries: [] }, base), ValidationError)
  assert.throws(() => normalizeSettings({ globalCountries: ['CN'] }, base), ValidationError)
})

test('config loading drops invalid entries instead of failing', () => {
  const config = normalizeConfig({
    settings: { intervalMinutes: 999, globalCountries: ['US'] },
    sites: [
      { id: 'site_ok', url: 'example.com' },
      { id: 'site_bad', url: 'ftp://bad' },
    ],
    servers: [{ id: 'srv_ok', target: 'host', user: 'root' }, { target: '-bad' }],
    github: { repos: [{ repo: 'a/b' }, { repo: 'bad' }] },
    cloudflare: { projects: [{ project: 'ok' }, { project: 'bad name' }] },
  })
  assert.equal(config.sites.length, 1)
  assert.equal(config.servers.length, 1)
  assert.equal(config.github.repos.length, 1)
  assert.equal(config.cloudflare.projects.length, 1)
  // Invalid settings degrade to defaults.
  assert.equal(config.settings.intervalMinutes, 15)
})

test('server updates preserve identity and can change every connection field', () => {
  const original = createServer({ label: 'old', target: 'old.example.com', user: '', identityFile: '' })
  const updated = updateServer(original, {
    label: 'new',
    target: 'new.example.com',
    user: 'root',
    port: 2222,
    identityFile: '~/.ssh/id_ed25519',
  })
  assert.equal(updated.id, original.id)
  assert.equal(updated.createdAt, original.createdAt)
  assert.equal(updated.label, 'new')
  assert.equal(updated.target, 'new.example.com')
  assert.equal(updated.user, 'root')
  assert.equal(updated.port, 2222)
  assert.equal(updated.identityFile, '~/.ssh/id_ed25519')
})

test('CN city setting accepts a known city and rejects unknown values', () => {
  assert.equal(normalizeSettings({ cnCity: 'Shanghai' }).cnCity, 'Shanghai')
  assert.equal(normalizeSettings({ cnCity: '' }).cnCity, '')
  assert.throws(() => normalizeSettings({ cnCity: 'Nowhere' }), ValidationError)
  assert.ok(CN_CITY_CHOICES.includes("Xi'an"))
})
