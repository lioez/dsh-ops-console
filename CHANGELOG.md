# Changelog

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
