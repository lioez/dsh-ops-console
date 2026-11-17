/**
 * SSH server status.
 *
 * One fixed, read-only command runs over a non-interactive SSH session. The
 * plugin never asks for a password, never reads the user's SSH config and
 * never passes user text through a shell. An unknown host key fails with an
 * instruction instead of weakening host verification.
 *
 * @module dsh-ops-console/src/providers/ssh
 */

import { commandFailure, runCli } from '../cli.js'
import { expandHome } from '../paths.js'

/** Overall SSH budget. */
export const SSH_TIMEOUT_MS = 20_000
/** Raw output retained for the details panel. */
export const SSH_RAW_LIMIT = 8 * 1024

/**
 * POSIX, read-only status script. It is sent as a single argument to ssh and
 * contains no values supplied by the user.
 */
export const REMOTE_STATUS_COMMAND = [
  'export LC_ALL=C;',
  "printf '###HOST\\n'; hostname 2>/dev/null || uname -n;",
  "printf '###OS\\n'; grep -m1 '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d '\\\"' || true;",
  "printf '###KERNEL\\n'; uname -r;",
  "printf '###UPTIME\\n'; cat /proc/uptime 2>/dev/null;",
  "printf '###LOAD\\n'; cat /proc/loadavg 2>/dev/null;",
  "printf '###CPU\\n'; nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null;",
  "printf '###MEM\\n'; head -n 5 /proc/meminfo 2>/dev/null;",
  "printf '###DISK\\n'; df -Pk / 2>/dev/null | tail -n 1;",
  "printf '###FAILED\\n'; systemctl --failed --no-legend 2>/dev/null | wc -l;",
  "printf '###DOCKER\\n'; docker ps -q 2>/dev/null | wc -l;",
  "printf '###END\\n';",
].join(' ')

/**
 * Build ssh arguments for one server. Exported for tests.
 * @param {object} server config server.
 * @returns {string[]}
 */
export function buildSshArgs(server) {
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    '-o', 'ServerAliveInterval=5',
    '-o', 'ServerAliveCountMax=2',
    '-o', 'LogLevel=ERROR',
  ]
  if (Number.isInteger(server.port) && server.port > 0) args.push('-p', String(server.port))
  if (typeof server.identityFile === 'string' && server.identityFile.trim() !== '') {
    args.push('-i', expandHome(server.identityFile))
  }
  const target = String(server.target ?? '')
  if (target.startsWith('-') || target === '') throw new Error('invalid ssh target')
  const destination = typeof server.user === 'string' && server.user !== '' ? `${server.user}@${target}` : target
  args.push(destination, REMOTE_STATUS_COMMAND)
  return args
}

/**
 * Quote one shell argument for a command the user copies into a terminal.
 * @param {string} value
 * @returns {string}
 */
function shellQuote(value) {
  return `'${String(value).replace(/'/gu, `'\\''`)}'`
}

/**
 * A non-BatchMode command the user can run in a terminal to inspect or confirm
 * the host key. It includes the same identity and port as the plugin check.
 *
 * @param {object} server
 * @returns {string}
 */
export function sshCommandFor(server) {
  const args = ['ssh']
  if (Number.isInteger(server?.port) && server.port > 0) args.push('-p', String(server.port))
  if (typeof server?.identityFile === 'string' && server.identityFile.trim() !== '') {
    args.push('-i', shellQuote(expandHome(server.identityFile)))
  }
  const target = String(server?.target ?? '')
  const destination = typeof server?.user === 'string' && server.user !== '' ? `${server.user}@${target}` : target
  args.push(shellQuote(destination))
  return args.join(' ')
}

/**
 * @param {string} value
 * @returns {number|null}
 */
function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/**
 * Parse the marker-delimited output of REMOTE_STATUS_COMMAND.
 * @param {string} raw
 * @returns {object}
 */
export function parseStatusOutput(raw) {
  const text = typeof raw === 'string' ? raw : ''
  const sections = {}
  let current = ''
  for (const line of text.split(/\r?\n/u)) {
    const marker = /^###([A-Z]+)$/u.exec(line.trim())
    if (marker) {
      current = marker[1]
      sections[current] = []
      continue
    }
    if (current !== '') sections[current].push(line)
  }

  const joined = (name) => (sections[name] ?? []).join('\n').trim()
  const firstLine = (name) => {
    const value = joined(name).split(/\r?\n/u)[0] ?? ''
    return value.trim()
  }

  const uptimeSeconds = numberOrNull((joined('UPTIME').split(/\s+/u)[0] ?? '').trim())
  const load = (joined('LOAD').split(/\s+/u).filter(Boolean).slice(0, 3).map(Number)).filter(Number.isFinite)
  const cores = numberOrNull(firstLine('CPU'))

  const memTotalKb = numberOrNull((/MemTotal:\s+(\d+)\s+kB/u.exec(joined('MEM')) ?? [])[1])
  const memAvailableKb = numberOrNull((/MemAvailable:\s+(\d+)\s+kB/u.exec(joined('MEM')) ?? [])[1])
  const memory = memTotalKb !== null && memTotalKb > 0
    ? {
        totalBytes: memTotalKb * 1024,
        availableBytes: (memAvailableKb ?? 0) * 1024,
        usedPct: memAvailableKb === null ? null : Math.max(0, Math.min(100, Math.round((1 - memAvailableKb / memTotalKb) * 100))),
      }
    : null

  const diskParts = joined('DISK').split(/\s+/u).filter(Boolean)
  const diskTotalKb = numberOrNull(diskParts[1])
  const diskUsedKb = numberOrNull(diskParts[2])
  const disk = diskTotalKb !== null && diskTotalKb > 0
    ? {
        totalBytes: diskTotalKb * 1024,
        usedBytes: (diskUsedKb ?? 0) * 1024,
        usedPct: diskUsedKb === null ? null : Math.max(0, Math.min(100, Math.round((diskUsedKb / diskTotalKb) * 100))),
      }
    : null

  const failedUnits = numberOrNull((joined('FAILED').split(/\r?\n/u).filter((line) => line.trim() !== '').pop() ?? '').trim())
  const dockerContainers = numberOrNull((joined('DOCKER').split(/\r?\n/u).filter((line) => line.trim() !== '').pop() ?? '').trim())

  const warnings = []
  if (disk?.usedPct !== null && disk?.usedPct !== undefined && disk.usedPct >= 85) warnings.push(`磁盘使用率 ${disk.usedPct}%`)
  if (memory?.usedPct !== null && memory?.usedPct !== undefined && memory.usedPct >= 90) warnings.push(`内存使用率 ${memory.usedPct}%`)
  if (load.length > 0 && cores !== null && cores > 0 && load[0] / cores > 2) {
    warnings.push(`1 分钟负载 ${load[0].toFixed(2)} / ${cores} 核`)
  }
  if (failedUnits !== null && failedUnits > 0) warnings.push(`${failedUnits} 个 systemd failed unit`)

  return {
    hostname: firstLine('HOST').slice(0, 160),
    os: firstLine('OS').slice(0, 160) || firstLine('KERNEL').slice(0, 160),
    kernel: firstLine('KERNEL').slice(0, 160),
    uptimeSeconds: uptimeSeconds === null ? null : Math.max(0, Math.floor(uptimeSeconds)),
    load,
    cores: cores === null ? null : Math.max(1, Math.floor(cores)),
    memory,
    disk,
    failedUnits,
    dockerContainers,
    warnings,
  }
}

/**
 * Turn an ssh failure into a user-facing diagnosis.
 * @param {object} result runCli result.
 * @returns {{ code: string, message: string, hint: string }}
 */
export function classifySshError(result, server = null) {
  if (!result.installed) {
    return { code: 'ssh_missing', message: '本机没有可执行的 ssh', hint: '安装 OpenSSH，或确认 ssh 在 PATH 中。' }
  }
  if (result.timedOut) {
    return { code: 'timeout', message: 'SSH 连接超时', hint: '检查主机地址、端口和网络；可以先在终端执行一次下面这条命令了解详细原因。', command: server ? sshCommandFor(server) : '' }
  }
  if (result.aborted) return { code: 'cancelled', message: 'SSH 检测已取消', hint: '' }
  const haystack = `${result.stderr ?? ''}\n${result.error ?? ''}`
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/iu.test(haystack)) {
    return { code: 'host_key', message: 'SSH 主机密钥未验证', hint: '在终端运行下面这条命令，确认主机指纹后重试。插件不会自动关闭 host key 校验。', command: server ? sshCommandFor(server) : '' }
  }
  if (/Permission denied|publickey|no supported authentication/iu.test(haystack)) {
    return { code: 'auth', message: 'SSH 认证失败', hint: '确认密钥已加入 ssh-agent 或 ~/.ssh/config，并且该用户允许登录。', command: server ? sshCommandFor(server) : '' }
  }
  if (/Could not resolve hostname|Name or service not known|nodename nor servname/iu.test(haystack)) {
    return { code: 'dns', message: '无法解析服务器地址', hint: '检查 ssh 别名或域名。', command: server ? sshCommandFor(server) : '' }
  }
  if (/Connection refused/iu.test(haystack)) {
    return { code: 'refused', message: 'SSH 端口拒绝连接', hint: '确认端口和 sshd 是否在运行。', command: server ? sshCommandFor(server) : '' }
  }
  if (/Connection timed out|Operation timed out|No route to host/iu.test(haystack)) {
    return { code: 'timeout', message: 'SSH 连接超时', hint: '检查防火墙、端口和网络。', command: server ? sshCommandFor(server) : '' }
  }
  return { code: 'ssh_error', message: commandFailure(result, 'SSH 检测失败'), hint: '展开原始输出查看 ssh 的详细错误。', command: server ? sshCommandFor(server) : '' }
}

/**
 * @param {object} server config server.
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.run] injected runCli for tests.
 * @returns {Promise<object>}
 */
export async function probeServer(server, options = {}) {
  const started = Date.now()
  const run = options.run ?? runCli
  let result
  try {
    const args = buildSshArgs(server)
    result = await run('ssh', args, {
      timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : SSH_TIMEOUT_MS,
      signal: options.signal,
    })
  } catch (error) {
    result = {
      ok: false,
      installed: true,
      error: String(error?.message ?? error),
      stderr: '',
      timedOut: false,
      aborted: false,
    }
  }
  const checkedAt = Date.now()

  if (!result.ok) {
    return {
      checkedAt,
      durationMs: Date.now() - started,
      status: 'offline',
      error: classifySshError(result, server),
      raw: String(result.stderr ?? '').slice(0, SSH_RAW_LIMIT),
      hostname: '',
      os: '',
      kernel: '',
      uptimeSeconds: null,
      load: [],
      cores: null,
      memory: null,
      disk: null,
      failedUnits: null,
      dockerContainers: null,
      warnings: [],
    }
  }

  const parsed = parseStatusOutput(result.stdout)
  if (!parsed.hostname && !parsed.os && !parsed.kernel) {
    return {
      checkedAt,
      durationMs: Date.now() - started,
      status: 'offline',
      error: {
        code: 'bad_output',
        message: 'SSH 已连接，但没有读到状态输出',
        hint: '远端可能不是 Linux，或 shell 启动时输出了额外内容。展开原始输出查看。',
      },
      raw: String(result.stdout ?? '').slice(0, SSH_RAW_LIMIT),
      ...parsed,
    }
  }

  return {
    checkedAt,
    durationMs: Date.now() - started,
    status: parsed.warnings.length > 0 ? 'warning' : 'online',
    error: null,
    raw: String(result.stdout ?? '').slice(0, SSH_RAW_LIMIT),
    ...parsed,
  }
}
