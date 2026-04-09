# @icjia/plausible-mcp

Lightweight MCP server that queries a self-hosted [Plausible Analytics](https://plausible.io/) instance and returns compressed, actionable results optimized for Claude's context window.

Built for [ICJIA](https://icjia.illinois.gov)'s 15+ state agency web properties monitored under a single Plausible CE instance at `plausible.icjia.cloud`.

## Features

- **6 tools** — overview, pages, breakdown, timeseries, site discovery, health check
- **Compressed output** — structured plain text, 10-300 tokens per query instead of raw JSON
- **Computed deltas** — period-over-period comparison on every overview query
- **Filters** — human-readable syntax: `"page contains /grants"`, `"source is Google"`
- **Security-first** — 12-layer security model including input validation, output sanitization, rate limiting, SSRF prevention, and prompt injection defense
- **90s response cache** — reduces API load during iterative analysis
- **Zero build step** — plain JavaScript ES modules, ships as-is to npm

## Requirements

- Node.js >= 22 (see `.nvmrc`)
- A self-hosted Plausible CE instance with the v2 Query API
- A Plausible API key with Stats API scope

## Installation

```bash
npx @icjia/plausible-mcp
```

Or install globally:

```bash
npm install -g @icjia/plausible-mcp
```

## Configuration

Set these environment variables:

| Variable | Required | Description |
|---|---|---|
| `PLAUSIBLE_BASE_URL` | Yes | Plausible instance URL (e.g., `https://plausible.icjia.cloud`) |
| `PLAUSIBLE_API_KEY` | Yes | Stats API Bearer token |
| `PLAUSIBLE_DEFAULT_SITE` | No | Default site_id so you don't repeat it every call |

## Register with Claude Code

```bash
claude mcp add plausible-mcp -s user \
  -e PLAUSIBLE_BASE_URL=https://plausible.icjia.cloud \
  -e PLAUSIBLE_API_KEY=your-key \
  -e PLAUSIBLE_DEFAULT_SITE=icjia.illinois.gov \
  -- npx -y @icjia/plausible-mcp
```

## Tools

| Tool | Purpose |
|---|---|
| `query_overview` | Aggregate stats with computed deltas. "How's this site doing?" |
| `query_pages` | Top or bottom pages by any metric. "What's popular?" |
| `query_breakdown` | Traffic by source, country, device, browser, OS, UTMs. |
| `query_timeseries` | Trends over time. "Is traffic going up or down?" |
| `list_sites` | Discover all sites on the Plausible instance. |
| `get_status` | Server version, connectivity, realtime visitors. |

## Example output

```
icjia.illinois.gov [30d] Vis:12.4K(+8%) Sess:15.8K(+3%) PV:42.1K(-2%) Bounce:58.3%(+1.2pp) Dur:2m14s(+12%)
```

## CLI

All tools are also available as CLI subcommands:

```bash
plausible-mcp overview icjia.illinois.gov
plausible-mcp pages icjia.illinois.gov --sort asc --limit 5
plausible-mcp breakdown icjia.illinois.gov --dimension visit:source
plausible-mcp timeseries icjia.illinois.gov --period 6mo
plausible-mcp list-sites
plausible-mcp status
```

Running without a subcommand starts the MCP server (stdio mode).

## Security

12-layer security model. See [docs/doc-00-master-design.md](docs/doc-00-master-design.md) for full details.

1. Input validation with allowlists and length caps
2. Output sanitization (prompt injection prevention)
3. Rate limiting (600/hr, 3 concurrent, 15s timeout)
4. Response body size cap (5MB) and schema validation
5. Error sanitization with actionable messages
6. Base URL validation (SSRF prevention)
7. Response Content-Type validation
8. Cache integrity (only validated responses cached)
9. Static code constraints (no eval, no dynamic import)
10. API key protection (masked everywhere)
11. Dependency pinning (exact versions)
12. Transport isolation (stdio only, no open ports)

## Development

```bash
nvm use
npm install
npm test
```

## License

MIT - see [LICENSE](LICENSE).
