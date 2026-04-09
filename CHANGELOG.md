# Changelog

## 0.1.3 — 2026-04-09

- Switched from Plausible v2 API to v1 API for compatibility with older self-hosted Plausible CE instances
- Fixed v1 filter wildcards: uses `**` glob pattern for contains matching
- Fixed missing @cfworker/json-schema peer dependency required by @modelcontextprotocol/server
- Added .vscode/ to .gitignore
- Hardened publish.sh: npm auth check, dirty-tree guard, branch warning, tag conflict check, scoped git add
- Fixed repository URL format in package.json

## 0.1.0 — 2026-04-09

- Full implementation: config.js, runner.js, compress.js, server.js, cli.js
- 6 MCP tools: query_overview, query_pages, query_breakdown, query_timeseries, list_sites, get_status
- Computed period-over-period deltas on query_overview
- Human-readable filter syntax (e.g., "page contains /grants")
- 90-second response cache with LRU eviction and integrity validation
- 12-layer security model (input validation, output sanitization, rate limiting, SSRF prevention, etc.)
- Full error message table with actionable diagnostics for Claude
- 114 tests across 4 test files (security, compression, integration, timeseries)
- Aligned with @icjia/lightcap MCP SDK pattern (@modelcontextprotocol/server v2, Zod v4)
- Comprehensive README with setup instructions for Claude Code, Cursor, VS Code, Windsurf
- Initial design documents (doc-00, doc-07, doc-10)
