# Ops console · dsh-ops-console

[中文](README.md) | English

[![test](https://github.com/lioez/dsh-ops-console/actions/workflows/test.yml/badge.svg)](https://github.com/lioez/dsh-ops-console/actions/workflows/test.yml)
[![license](https://img.shields.io/github/license/lioez/dsh-ops-console)](LICENSE)

A local DeepSeek Harness plugin that adds an **Ops console** entry to the left
sidebar. It shows GitHub, Cloudflare and SSH server status, and checks deployed
websites from this Mac plus mainland-China and overseas Globalping probes.

![Ops console website details](docs/screenshot.png)

The screenshot uses `example.com`; real configuration stays on your machine.

## Features

- Overview: site health, CN/global median latency, server availability, GitHub
  and Cloudflare connection state.
- Websites: add/remove sites, manual or scheduled checks, local + CN + overseas
  results, TLS expiry, per-node latency, redirects, uptime history.
- Servers are compact by default: address, status and one summary line; expand
  for full metrics. Edit the label, target, user, port or key, or use a one-shot
  password for a manual check.
- Servers: read-only SSH status — hostname, OS, uptime, load, memory, disk,
  failed systemd units and Docker container count.
- Platforms: GitHub login and watched-repository Actions/PR summaries; Cloudflare
  account, Pages projects and recent deployments.
- Settings: monitor interval, CN probe count, overseas countries, Globalping
  quota, data directory and cache controls.

## Install

Requires DeepSeek Harness `>= 0.2.2-rc.3`. This is a local plugin; it is not
published to npm.

```bash
git clone https://github.com/lioez/dsh-ops-console.git
```

Then use **Plugins → Add plugin** in DSH, or install with:

```text
plugin_manager install_bundle → target: /absolute/path/to/dsh-ops-console
```

Refresh the Web GUI after installation. The entry appears in the left sidebar as
**运维台** (Ops console).

## Prerequisites

- **GitHub**: `gh` installed and signed in (`gh auth login`).
- **Cloudflare**: `wrangler` installed and signed in (`wrangler login`), with
  access to your Pages projects. v1 covers Pages only; use the dashboard for
  Zones/DNS/Workers.
- **SSH**: key-based or ssh-agent login should work non-interactively. The
  plugin does not read `~/.ssh/config`; `ssh` resolves it. A password can be
  entered for one manual check and is never stored. Host-key verification is
  never weakened.
- **Website checks**: no API key. Globalping's anonymous quota applies; when it
  is exhausted, the local probe still runs.

## Status meanings

- **Up**: local 2xx/3xx, no failed CN/overseas probes, valid TLS.
- **Degraded**: still reachable, but some probes failed, TLS is invalid/expiring, or the local probe got 401/403 (WAF/auth).
- **Down**: unreachable locally, or an unexpected 4xx/5xx status.
- **Unknown**: no completed check yet, or the last check was cancelled.

The Sites tab contains the same guide, and status pills carry the definition as a tooltip. A cancelled check does not overwrite the previous result.

## SSH keys and host fingerprints

- With an empty identity path, `ssh` itself uses `~/.ssh/config`, default keys (`~/.ssh/id_*`) and ssh-agent. The plugin does not read those files and never stores passwords.
- On macOS, **Choose file…** opens the system file chooser. Other platforms need a typed path.
- A private key must be owner-only (`chmod 600`). When it is too permissive, `ssh` ignores it and the plugin returns a copyable `chmod` command.
- An empty user uses the local account name, not root by default; set the remote user explicitly (`root`, `ubuntu`, etc.).
- **Password**: optional, manual-only, never written to config. Scheduled checks still use a key or ssh-agent.
- **Edit**: the server card can change its label, target, user, port and key. Connection changes clear the stale cache and re-check.
- **Drafts**: the add-server form is kept in local browser storage across tab switches; passwords are excluded.
- Inspect `ls -la ~/.ssh`, `ssh-add -l`, and `ssh -G <alias>`.
- Add a key with `ssh-add ~/.ssh/id_ed25519` (macOS may use `--apple-use-keychain`).
- When the host key is not verified, server details show a copyable `ssh ...` command. Run it once, confirm the fingerprint, then retry. The plugin never disables host-key checking.

## Privacy

Configuration and history live in `$DSH_HOME/ops-console/` (mode `0700`,
files `0600`). No GitHub/Cloudflare token, SSH password or private key is stored.
Commands reuse the existing CLI/SSH setup. Query strings and fragments are
removed from monitored URLs before sending a target to Globalping. Remote writes
(restart, deploy, purge cache, re-run workflow) are not implemented in v1.

## Data sources

- Local: Node `http`/`https`, recording DNS, TCP, TLS, first byte and total time.
- Multi-region: [Globalping](https://globalping.io/docs/api.globalping.io).
  The anonymous 250/hour quota is counted per public egress IP, not tied to an
  account; other clients behind the same IP share it. Globalping does not expose
  probe IDs; the CN city setting narrows probes to one city to avoid a random
  unstable node.
- Manual: [itdog](https://www.itdog.cn/http/) deep link. itdog has no public API;
  the plugin does not scrape it or embed it in an iframe.

## Test

```bash
node --test test/*.test.js
node --check client.js
```

CI runs the same suite on Node 22 and 24.

## Limitations

- Monitoring only runs while DSH is open; it is not a 24/7 external probe.
- Password login is manual-only; scheduled checks never store a password.
- Globalping can filter by city/country/ASN, not select a specific probe ID.
- Read-only: no remote restart, deployment, cache purge or workflow re-run.
- Cloudflare: Pages only.
- SSH metrics target Linux; macOS targets return partial `/proc` metrics.
- Globalping node count and quota are controlled by a third party.
- The itdog link is a manual convenience, not an automated data source.

See [SECURITY.md](SECURITY.md) for the security model and private reporting.

## License

MIT © 2026 [Lioez](https://github.com/lioez)
