import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildMeasurement, fetchLimits, groupResults, probeGlobalping } from '../src/probes/globalping.js'

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    async json() {
      return body
    },
  }
}

const finished = {
  status: 'finished',
  results: [
    {
      probe: { country: 'CN', city: 'Shanghai', network: 'China Unicom', asn: 17621 },
      result: { status: 'finished', statusCode: 200, timings: { total: 100, firstByte: 80 } },
    },
    {
      probe: { country: 'CN', city: 'Chengdu', network: 'Alibaba', asn: 37963 },
      result: { status: 'finished', statusCode: 200, timings: { total: 200, firstByte: 180 } },
    },
    {
      probe: { country: 'US', city: 'Buffalo', network: 'HostPapa', asn: 36352 },
      result: { status: 'finished', statusCode: 200, timings: { total: 300, firstByte: 280 } },
    },
    {
      probe: { country: 'DE', city: 'Nuremberg', network: 'Hetzner', asn: 24940 },
      result: { status: 'failed', error: 'timeout' },
    },
  ],
}

test('measurement payload carries target, path, port and region limits', () => {
  const payload = buildMeasurement(
    { url: 'https://example.com:8443/path?secret=1' },
    { cnProbes: 2, globalCountries: ['US', 'DE'] },
  )
  assert.equal(payload.type, 'http')
  assert.equal(payload.target, 'example.com')
  assert.equal(payload.measurementOptions.protocol, 'HTTPS')
  assert.equal(payload.measurementOptions.port, 8443)
  assert.equal(payload.measurementOptions.request.path, '/path')
  assert.deepEqual(payload.locations, [
    { country: 'CN', limit: 2 },
    { country: 'US', limit: 1 },
    { country: 'DE', limit: 1 },
  ])
  const shanghai = buildMeasurement(
    { url: 'https://example.com/' },
    { cnProbes: 1, cnCity: 'Shanghai', globalCountries: ['US'] },
  )
  assert.deepEqual(shanghai.locations[0], { country: 'CN', city: 'Shanghai', limit: 1 })
})

test('groupResults separates CN from overseas and computes medians', () => {
  const groups = groupResults(finished.results)
  assert.equal(groups.cn.total, 2)
  assert.equal(groups.cn.success, 2)
  assert.equal(groups.cn.medianMs, 150)
  assert.equal(groups.cn.minMs, 100)
  assert.equal(groups.cn.maxMs, 200)
  assert.equal(groups.global.total, 2)
  assert.equal(groups.global.success, 1)
  assert.equal(groups.global.failed, 1)
  assert.equal(groups.global.medianMs, 300)
  assert.equal(groups.global.failures[0].city, 'Nuremberg')
})

test('fetchLimits parses the anonymous quota', async () => {
  const limits = await fetchLimits({
    fetchImpl: async () => response(200, {
      rateLimit: { measurements: { create: { limit: 250, remaining: 244, reset: 3511 } } },
    }),
  })
  assert.equal(limits.limit, 250)
  assert.equal(limits.remaining, 244)
  assert.equal(limits.resetIn, 3511)
  assert.equal(limits.error, null)
})

test('probeGlobalping creates, polls and returns grouped results', async () => {
  let creates = 0
  let polls = 0
  const fetchImpl = async (url, init) => {
    if (init.method === 'POST') {
      creates += 1
      return response(200, { id: 'm1', probesCount: 4 })
    }
    polls += 1
    return response(200, finished)
  }
  const result = await probeGlobalping(
    { url: 'https://example.com/' },
    { fetchImpl, cnProbes: 2, globalCountries: ['US', 'DE'], timeoutMs: 5_000 },
  )
  assert.equal(creates, 1)
  assert.equal(polls, 1)
  assert.equal(result.ok, true)
  assert.equal(result.measurementId, 'm1')
  assert.equal(result.cn.medianMs, 150)
  assert.equal(result.global.total, 2)
})

test('a 429 is reported as rate limited without polling', async () => {
  let polls = 0
  const result = await probeGlobalping(
    { url: 'https://example.com/' },
    {
      fetchImpl: async (url, init) => {
        if (init.method === 'POST') {
          return response(429, { error: { message: 'limit exceeded' } })
        }
        polls += 1
        return response(200, finished)
      },
      timeoutMs: 2_000,
    },
  )
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'rate_limited')
  assert.equal(polls, 0)
})
