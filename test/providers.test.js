import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  detectCloudflare,
  fetchPagesDeployments,
  fetchPagesProjects,
  parseDeployments,
  parsePagesProjects,
} from '../src/providers/cloudflare.js'
import {
  detectGithub,
  fetchRepo,
  validateRepoAccess,
} from '../src/providers/github.js'

function result(stdout, { ok = true, stderr = '', installed = true } = {}) {
  return { ok, installed, stdout, stderr, code: ok ? 0 : 1, error: ok ? '' : 'failed', timedOut: false, aborted: false }
}

function fakeRun(table) {
  return async (_name, args) => {
    const key = args.join(' ')
    for (const [needle, value] of Object.entries(table)) {
      if (key.includes(needle)) return typeof value === 'function' ? value(args) : value
    }
    return result('', { ok: false, stderr: `unexpected args: ${key}` })
  }
}

test('GitHub detection reports connected, missing and signed-out states', async () => {
  const connected = await detectGithub({
    run: fakeRun({
      '--version': result('gh version 2.92.0\n'),
      'auth status': result(JSON.stringify({
        hosts: { 'github.com': [{ state: 'success', active: true, login: 'lioez' }] },
      })),
    }),
  })
  assert.equal(connected.state, 'connected')
  assert.equal(connected.account.login, 'lioez')
  assert.equal(connected.error, null)

  const missing = await detectGithub({
    run: async () => result('', { ok: false, installed: false }),
  })
  assert.equal(missing.state, 'not-installed')

  const signedOut = await detectGithub({
    run: fakeRun({
      '--version': result('gh version 2.92.0\n'),
      'auth status': result('', { ok: false, stderr: 'not logged in' }),
    }),
  })
  assert.equal(signedOut.state, 'not-authenticated')
  assert.match(signedOut.error.hint, /gh auth login/u)
})

test('GitHub repository queries are parsed into the UI shape', async () => {
  const run = fakeRun({
    'repo view lioez/site': result(JSON.stringify({
      nameWithOwner: 'lioez/site',
      url: 'https://github.com/lioez/site',
      description: 'A site',
      visibility: 'PUBLIC',
      defaultBranchRef: { name: 'main' },
    })),
    'run list': result(JSON.stringify([{
      databaseId: 42,
      workflowName: 'CI',
      displayTitle: 'Fix build',
      status: 'completed',
      conclusion: 'success',
      headBranch: 'main',
      createdAt: '2026-11-17T00:00:00Z',
      url: 'https://github.com/lioez/site/actions/runs/42',
    }])),
    'pr list': result(JSON.stringify([{
      number: 7,
      title: 'Update copy',
      url: 'https://github.com/lioez/site/pull/7',
      updatedAt: '2026-11-17T00:00:00Z',
    }])),
  })
  const value = await fetchRepo('lioez/site', { run })
  assert.equal(value.state, 'ok')
  assert.equal(value.repoInfo.defaultBranch, 'main')
  assert.equal(value.runs[0].conclusion, 'success')
  assert.equal(value.openPRs.count, 1)
  assert.equal(value.openPRs.items[0].number, 7)
})

test('GitHub repo validation rejects an unreadable repo', async () => {
  const ok = await validateRepoAccess('a/b', {
    run: fakeRun({ 'repo view': result(JSON.stringify({ nameWithOwner: 'a/b' })) }),
  })
  assert.equal(ok.ok, true)
  const bad = await validateRepoAccess('a/b', {
    run: fakeRun({ 'repo view': result('', { ok: false, stderr: 'HTTP 404' }) }),
  })
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, 'repo_not_found')
})

test('Cloudflare detection and account selection', async () => {
  const run = fakeRun({
    '--version': result('4.164.0\n'),
    whoami: result(JSON.stringify({
      loggedIn: true,
      email: 'loez@example.com',
      accounts: [
        { id: 'acc-1', name: 'One' },
        { id: 'acc-2', name: 'Two' },
      ],
      tokenPermissions: ['pages:write', 'zone:read'],
    })),
  })
  const value = await detectCloudflare({ run, accountId: 'acc-2' })
  assert.equal(value.state, 'connected')
  assert.equal(value.account.id, 'acc-2')
  assert.equal(value.permissionsCount, 2)

  const signedOut = await detectCloudflare({
    run: fakeRun({
      '--version': result('4.164.0\n'),
      whoami: result(JSON.stringify({ loggedIn: false })),
    }),
  })
  assert.equal(signedOut.state, 'not-authenticated')
  assert.match(signedOut.error.hint, /wrangler login/u)
})

test('Cloudflare Pages project and deployment output is parsed', () => {
  const projects = parsePagesProjects([
    {
      'Project Name': 'site',
      'Project Domains': 'site.pages.dev, custom.example.com',
      'Git Provider': 'Yes',
      'Last Modified': '6 months ago',
    },
  ])
  assert.deepEqual(projects[0].domains, ['site.pages.dev', 'custom.example.com'])
  assert.equal(projects[0].gitProvider, true)

  const deployments = parseDeployments([
    {
      Id: 'd1',
      Environment: 'Production',
      Branch: 'main',
      Source: 'abc1234',
      Deployment: 'https://d1.site.pages.dev',
      Status: '2 hours ago',
      Build: 'https://dash.cloudflare.com/...',
    },
  ])
  assert.equal(deployments[0].environment, 'Production')
  assert.equal(deployments[0].url, 'https://d1.site.pages.dev')
  assert.equal(deployments[0].statusText, '2 hours ago')
})

test('Cloudflare list queries use JSON and the selected account', async () => {
  const calls = []
  const run = async (_name, args, options) => {
    calls.push({ args, env: options.env })
    if (args.includes('project')) {
      return result(JSON.stringify([{ 'Project Name': 'site', 'Project Domains': 'site.pages.dev' }]))
    }
    return result(JSON.stringify([{ Id: 'd1', Environment: 'Production' }]))
  }
  const projects = await fetchPagesProjects({ run, accountId: 'acc-1' })
  assert.equal(projects.ok, true)
  assert.equal(projects.projects[0].project, 'site')
  const deployments = await fetchPagesDeployments('site', { run, accountId: 'acc-1' })
  assert.equal(deployments.ok, true)
  assert.equal(deployments.deployments[0].environment, 'Production')
  assert.ok(calls.every((call) => call.env.CLOUDFLARE_ACCOUNT_ID === 'acc-1'))
})
