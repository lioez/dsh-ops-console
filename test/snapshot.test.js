import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifySite, uptimeOf } from '../src/snapshot.js'

function last(overrides = {}) {
  return {
    local: {
      ok: true,
      reachable: true,
      status: 200,
      statusText: 'OK',
      timings: { totalMs: 80 },
      tls: { valid: true, daysLeft: 90 },
      error: null,
    },
    cn: { total: 2, success: 2, failed: 0, medianMs: 100, skipped: false },
    global: { total: 2, success: 2, failed: 0, medianMs: 200, skipped: false },
    ...overrides,
  }
}

test('site classification covers up, degraded and down', () => {
  assert.equal(classifySite(last()).status, 'up')
  assert.equal(classifySite(last({ local: { ...last().local, status: 500, ok: false } })).status, 'down')
  assert.equal(classifySite(last({ local: { ...last().local, status: 403, ok: false } })).status, 'degraded')
  const tls = last({ local: { ...last().local, tls: { valid: true, daysLeft: 5 } } })
  assert.equal(classifySite(tls).status, 'degraded')
  assert.ok(classifySite(tls).reasons.some((line) => line.includes('5 天')))
  const cnDown = last({ cn: { total: 2, success: 0, failed: 2, medianMs: null, skipped: false } })
  assert.equal(classifySite(cnDown).status, 'degraded')
  assert.equal(classifySite(null).status, 'unknown')
})

test('uptime is computed over the stored window', () => {
  assert.equal(uptimeOf([{ status: 'up' }, { status: 'down' }, { status: 'up' }]), 66.7)
  assert.equal(uptimeOf([{ status: 'up' }, { status: 'degraded' }]), 100)
  assert.equal(uptimeOf([]), null)
  assert.equal(uptimeOf(undefined), null)
})
