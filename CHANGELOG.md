# Changelog

## Unreleased

- Initial design documents (doc-00, doc-07, doc-10)
- 12-layer security model
- 6 MCP tools: query_overview, query_pages, query_breakdown, query_timeseries, list_sites, get_status
- Compressed plain-text output optimized for LLM context windows
- 90-second response cache with cache integrity validation
- Computed period-over-period deltas on query_overview
- Human-readable filter syntax (e.g., "page contains /grants")
- Full error message table with actionable diagnostics
