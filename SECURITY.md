# Security

## Reporting a vulnerability

Please use GitHub's **Security → Advisories → Report a vulnerability** flow for
this repository instead of opening a public issue. Include the affected
version, a minimal reproduction, and the impact you observed.

## Security model

- The plugin is a **local, read-only operations console**. It does not restart
  services, deploy, purge caches or re-run workflows.
- It never stores a GitHub/Cloudflare token, an SSH password or private-key
  material. It reuses the CLI login and the SSH key/agent already configured on
  the machine.
- It does not read `~/.ssh/config` or private keys. SSH itself resolves aliases.
- It does not weaken host-key verification or automatically accept unknown
  host keys.
- All external commands are launched with argument arrays, bounded output and
  timeouts; no user input is passed through a shell.
- HTTP routes are registered through `ctx.connection.fetch`, so DSH's own
  browser authentication and trust policy apply.

Supported release: `0.1.x`.
