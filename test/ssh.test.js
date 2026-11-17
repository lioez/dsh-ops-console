import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  buildSshArgs,
  classifySshError,
  sshCommandFor,
  parseStatusOutput,
  probeServer,
} from '../src/providers/ssh.js'

const output = [
  '###HOST',
  'vps01',
  '###OS',
  'Ubuntu 24.04 LTS',
  '###KERNEL',
  '6.8.0-45-generic',
  '###UPTIME',
  '86400.50 90000.00',
  '###LOAD',
  '0.50 0.40 0.30 1/200 1234',
  '###CPU',
  '4',
  '###MEM',
  'MemTotal:        2048000 kB',
  'MemFree:          100000 kB',
  'MemAvailable:    1024000 kB',
  '###DISK',
  '/dev/vda1 41152736 12345678 26700000 32% /',
  '###FAILED',
  '0',
  '###DOCKER',
  '2',
  '###END',
].join('\n')

test('ssh arguments are array-safe and use non-interactive mode', () => {
  const args = buildSshArgs({
    target: 'vps01',
    user: 'root',
    port: 2222,
    identityFile: '~/.ssh/id_ed25519',
  })
  assert.equal(args[0], '-o')
  assert.ok(args.includes('BatchMode=yes'))
  assert.deepEqual(args.slice(args.indexOf('-p'), args.indexOf('-p') + 2), ['-p', '2222'])
  assert.ok(args.includes(path.join(os.homedir(), '.ssh', 'id_ed25519')))
  assert.equal(args.at(-2), 'root@vps01')
  assert.equal(args.at(-1).includes('###DISK'), true)
  assert.throws(() => buildSshArgs({ target: '-oProxyCommand=bad' }))
})

test('the copyable verification command mirrors the server settings', () => {
  const command = sshCommandFor({ target: 'vps01', user: 'root', port: 2222, identityFile: '~/key/id_ed25519' })
  assert.match(command, /^ssh -p 2222 -i '/u)
  assert.match(command, /root@vps01/u)
})

test('status output parses host, load, memory, disk and warnings', () => {
  const parsed = parseStatusOutput(output)
  assert.equal(parsed.hostname, 'vps01')
  assert.equal(parsed.os, 'Ubuntu 24.04 LTS')
  assert.equal(parsed.kernel, '6.8.0-45-generic')
  assert.equal(parsed.uptimeSeconds, 86400)
  assert.deepEqual(parsed.load, [0.5, 0.4, 0.3])
  assert.equal(parsed.cores, 4)
  assert.equal(parsed.memory.usedPct, 50)
  assert.equal(parsed.disk.usedPct, 30)
  assert.equal(parsed.failedUnits, 0)
  assert.equal(parsed.dockerContainers, 2)
  assert.deepEqual(parsed.warnings, [])
})

test('high disk and failed units become warnings', () => {
  const parsed = parseStatusOutput(output.replace('12345678', '39000000').replace('###FAILED\n0', '###FAILED\n2'))
  assert.equal(parsed.disk.usedPct, 95)
  assert.equal(parsed.failedUnits, 2)
  assert.ok(parsed.warnings.some((line) => line.includes('磁盘')))
  assert.ok(parsed.warnings.some((line) => line.includes('systemd')))
})

test('ssh failures are classified for the user', () => {
  assert.equal(classifySshError({ installed: false }).code, 'ssh_missing')
  assert.equal(classifySshError({ installed: true, timedOut: true }).code, 'timeout')
  assert.equal(classifySshError({ installed: true, stderr: 'Permission denied (publickey).' }).code, 'auth')
  assert.equal(classifySshError({ installed: true, stderr: 'Host key verification failed.' }).code, 'host_key')
  assert.equal(classifySshError({ installed: true, stderr: 'Could not resolve hostname foo: Name or service not known' }).code, 'dns')
})

test('probeServer returns online or warning without throwing', async () => {
  const run = async () => ({ ok: true, installed: true, stdout: output, stderr: '', code: 0, error: '' })
  const online = await probeServer({ target: 'vps01' }, { run })
  assert.equal(online.status, 'online')
  assert.equal(online.durationMs >= 0, true)

  const warningRun = async () => ({
    ok: true,
    installed: true,
    stdout: output.replace('12345678', '39000000'),
    stderr: '',
    code: 0,
    error: '',
  })
  const warning = await probeServer({ target: 'vps01' }, { run: warningRun })
  assert.equal(warning.status, 'warning')
})

test('a failed ssh call returns an offline result with a diagnosis', async () => {
  const run = async () => ({
    ok: false,
    installed: true,
    stdout: '',
    stderr: 'Permission denied (publickey).',
    code: 255,
    error: '',
    timedOut: false,
    aborted: false,
  })
  const result = await probeServer({ target: 'vps01' }, { run })
  assert.equal(result.status, 'offline')
  assert.equal(result.error.code, 'auth')
  assert.match(result.error.hint, /ssh-agent|\.ssh\/config/u)
  assert.match(result.error.command, /^ssh /u)
})
