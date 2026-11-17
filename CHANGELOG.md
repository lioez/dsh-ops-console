# Changelog

## Unreleased

- Added a visible status guide and per-site reasons so "degraded" is explained in place.
- Added a native macOS private-key file picker for new SSH servers.
- Fixed the picker/form layout so the key field and submit button stay on one row.
- Detect private keys that are too permissive before running ssh and return the exact chmod command.
- Added SSH key-management help and a copyable host-key verification command.
- Explained that Globalping's anonymous quota is counted per public egress IP, not per account.
- Cancelled probes no longer overwrite the previous site result with a false down/degraded state.

## 0.1.0 — 2026-11-17

Initial public release.

- Local DSH console page at **运维台 / Ops console**.
- Website checks from the local Mac, mainland China probes and overseas probes via Globalping.
- HTTP status, DNS/TCP/TLS/TTFB/total timing, redirects, TLS certificate and per-node details.
- Historical uptime and latency sparkline, configurable monitor interval and probe regions.
- Read-only SSH server status (uptime, load, memory, disk, failed units, Docker containers).
- GitHub account and watched-repository Actions / pull-request summary via `gh`.
- Cloudflare account and Pages project / deployment summary via `wrangler`.
- Manual itdog deep link for nationwide checks; no scraping or iframe.
- Credentials stay in the existing CLI/SSH setup; no token or password storage.
