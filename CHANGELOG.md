# Changelog

## Unreleased

### 2026-04-09

- Full implementation: config.js, runner.js, compress.js, server.js, cli.js
- 6 MCP tools: query_overview, query_pages, query_breakdown, query_timeseries, list_sites, get_status
- Computed period-over-period deltas on query_overview
- Human-readable filter syntax (e.g., "page contains /grants")
- 90-second response cache with LRU eviction and integrity validation
- 12-layer security model (input validation, output sanitization, rate limiting, SSRF prevention, etc.)
- Full error message table with actionable diagnostics for Claude
- 124 tests across 4 test files (security, compression, integration, timeseries)
- Aligned with @icjia/lightcap MCP SDK pattern (@modelcontextprotocol/server v2, Zod v4)
- Comprehensive README with setup instructions for Claude Code, Cursor, VS Code, Windsurf
- Initial design documents (doc-00, doc-07, doc-10)
