import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { PICK_KEY_SCRIPT, pickPrivateKey } from '../src/picker.js'

test('the macOS picker returns the selected absolute path without reading it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ops-picker-'))
  const key = path.join(dir, 'id_ed25519')
  await fs.writeFile(key, 'not a real key')
  try {
    const calls = []
    const result = await pickPrivateKey({
      platform: 'darwin',
      run: async (file, args) => {
        calls.push([file, args])
        return { ok: true, stdout: `${key}\n`, stderr: '', code: 0, error: '', timedOut: false }
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.path, key)
    assert.equal(calls[0][0], 'osascript')
    assert.deepEqual(calls[0][1], ['-e', PICK_KEY_SCRIPT])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('cancellation and unsupported platforms are explicit', async () => {
  const cancelled = await pickPrivateKey({
    platform: 'darwin',
    run: async () => ({ ok: false, stdout: '', stderr: 'execution error: User canceled. (-128)', code: 1, error: '', timedOut: false }),
  })
  assert.equal(cancelled.code, 'cancelled')
  const unsupported = await pickPrivateKey({ platform: 'linux' })
  assert.equal(unsupported.code, 'unsupported')
  assert.match(unsupported.hint, /\.ssh/u)
})
