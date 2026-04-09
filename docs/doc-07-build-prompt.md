# Doc 07 — LLM Build Prompt: @icjia/plausible-mcp

> **Purpose:** Self-contained prompt for Claude Code to implement the plausible-mcp server. Feed this document at the start of each phase. All decisions are made — implement, don't redesign.

---

## Project Identity

- **Package:** `@icjia/plausible-mcp`
- **Repo:** `ICJIA/plausible-mcp`
- **Description:** Lightweight local MCP server that queries self-hosted Plausible Analytics and returns compressed, actionable results optimized for Claude's context window.
- **Reference implementation:** `@icjia/lightcap` (same architecture pattern)

## Stack

- Plain JavaScript, ES modules (`"type": "module"` in package.json)
- No build step — source files are what ships to npm
- Node.js >= 18
- Dependencies: `@modelcontextprotocol/sdk` (^1.29.0), `commander` (^12.0.0), `zod` (^3.23.0)
- Zero other dependencies

## Architecture

```
src/
├── config.js ........... Constants, VERSION from package.json, env validation, log()
├── runner.js ........... Plausible API client, rate limiting, validation, sanitization, filter parsing
├── compress.js ......... JSON → compressed plain text (the core of the server)
├── server.js ........... MCP server init + 6 tool registrations (Zod schemas)
└── cli.js .............. Commander CLI; no subcommand → starts MCP server mode
test/
├── security.test.js .... Input validation, sanitization, prompt injection defense
├── compress.test.js .... Compression format, output limits, number formatting
├── integration.test.js . Mock HTTP server tests for API client + error handling
└── timeseries.test.js .. Timeseries compression tests
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PLAUSIBLE_BASE_URL` | **Yes** | Self-hosted Plausible instance URL (e.g., `https://plausible.icjia.cloud`) |
| `PLAUSIBLE_API_KEY` | **Yes** | Stats API Bearer token |
| `PLAUSIBLE_DEFAULT_SITE` | No | Default site_id so you don't repeat it every call |

## Plausible v2 API Reference

**Endpoint:** `POST {baseUrl}/api/v2/query`

**Request body:**
```json
{
  "site_id": "example.com",
  "metrics": ["visitors", "pageviews", "bounce_rate"],
  "date_range": "30d",
  "dimensions": ["event:page"],
  "filters": [["contains", "event:page", ["/grants"]]],
  "order_by": [["visitors", "desc"]],
  "limit": 10,
  "include": { "time_labels": true }
}
```

**Response format (CRITICAL — get this right):**

ALL v2 responses return `results` as an **array of arrays**. Each inner array is a row: `[dim1?, dim2?, metric1, metric2, ...]`.

Aggregate (no dimensions):
```json
{ "results": [[12400, 15800, 42100, 58.3, 134]] }
```
Single row, metrics only. `results[0]` is `[12400, 15800, ...]`.

Breakdown (with dimensions):
```json
{
  "results": [
    ["/", 4200, 8100, 42.1],
    ["/about", 1800, 2300, 55.0]
  ]
}
```
Each row: `[page_path, visitors, pageviews, bounce_rate]`.

Timeseries (with time dimension):
```json
{
  "results": [
    ["2025-01-01", 1200, 3400, 55.2],
    ["2025-02-01", 1300, 3600, 53.1]
  ]
}
```
Each row: `[date_string, metric1, metric2, ...]`.

**Realtime endpoint (v1, used for health check):**
`GET {baseUrl}/api/v1/stats/realtime/visitors?site_id={siteId}`
Returns a plain integer (not JSON).

**Sites endpoint (v1, used for list_sites):**
`GET {baseUrl}/api/v1/sites?limit=100`
Returns:
```json
{
  "site_results": [
    { "domain": "icjia.illinois.gov", "timezone": "America/Chicago" },
    { "domain": "researchhub.icjia.dev", "timezone": "America/Chicago" }
  ],
  "meta": { "after": "...", "before": "...", "limit": 100 }
}
```
May return 403 if Sites API scope is not available. Handle gracefully.

**v2 date_range values:** `"day"`, `"7d"`, `"30d"`, `"month"`, `"6mo"`, `"12mo"`, `"all"`, or `["2025-01-01", "2025-01-31"]` (array of two ISO dates).

**v2 filter format:** Array of `[operator, dimension, [value1, value2, ...]]`. Operators: `is`, `is_not`, `contains`, `contains_not`. Multiple filters: `["and", [filter1], [filter2]]`.

---

## MCP Tools (6 total)

### 1. `query_pages`

Top or bottom pages by traffic.

| Param | Type | Default | Description |
|---|---|---|---|
| `siteId` | string? | env default | Domain in Plausible |
| `period` | enum | `30d` | day, 7d, 30d, month, 6mo, 12mo, all, custom |
| `dateRange` | string? | — | Required when period=custom: "YYYY-MM-DD,YYYY-MM-DD" |
| `limit` | int | 10 | 1–50 |
| `sort` | enum | `desc` | desc=most popular, asc=least popular |
| `metrics` | string[] | [visitors, pageviews, bounce_rate] | Metrics to return |
| `filter` | string? | — | e.g., "page contains /grants" |

**Compressed output:**
```
icjia.illinois.gov — Top pages [30d] (5 shown)
  1. / — Vis:4.2K PV:8.1K Bounce:42.1%
  2. /about — Vis:1.8K PV:2.3K Bounce:55.0%
```

### 2. `query_overview`

Aggregate stats for a site.

| Param | Type | Default |
|---|---|---|
| `siteId` | string? | env default |
| `period` | enum | `30d` |
| `dateRange` | string? | — |
| `metrics` | string[] | [visitors, visits, pageviews, bounce_rate, visit_duration] |
| `filter` | string? | — |

**Computed deltas:** `query_overview` automatically fetches the prior period of equal length and computes deltas. Two v2 API calls under the hood (current + prior), both cached.

Delta formatting rules:
- Count metrics (visitors, visits, pageviews, events): relative percent change → `(+8%)`, `(-3%)`
- Percentage metrics (bounce_rate): absolute change in percentage points → `(+1.2pp)`, `(-0.5pp)`
- Duration metrics (visit_duration): relative percent change → `(+12%)`
- Prior period is zero: `(new)`
- No change: `(=)`
- `period=all` or `period=custom`: skip delta (no meaningful prior period)

**Compressed output (single line with deltas):**
```
icjia.illinois.gov [30d] Vis:12.4K(+8%) Sess:15.8K(+3%) PV:42.1K(-2%) Bounce:58.3%(+1.2pp) Dur:2m14s(+12%)
```

### 3. `query_breakdown`

Break down by any dimension.

| Param | Type | Default |
|---|---|---|
| `siteId` | string? | env default |
| `period` | enum | `30d` |
| `dateRange` | string? | — |
| `dimension` | enum | *(required)* — visit:source, visit:country_name, visit:device, etc. |
| `limit` | int | 10 |
| `sort` | enum | `desc` |
| `metrics` | string[] | [visitors, pageviews, bounce_rate] |
| `filter` | string? | — |

### 4. `query_timeseries`

Trend data over time.

| Param | Type | Default |
|---|---|---|
| `siteId` | string? | env default |
| `period` | enum | `6mo` |
| `dateRange` | string? | — |
| `interval` | enum | `month` — day, week, month |
| `metrics` | string[] | [visitors, pageviews] |
| `filter` | string? | — |

**Compressed output:**
```
icjia.illinois.gov — timeseries [6mo] (monthly, 6 points)
  2025-01  Vis:1.2K  PV:3.4K
  2025-02  Vis:1.3K  PV:3.6K
  2025-03  Vis:1.1K  PV:3.1K
  2025-04  Vis:1.5K  PV:4.0K
  2025-05  Vis:1.4K  PV:3.8K
  2025-06  Vis:1.6K  PV:4.2K
```

### 5. `list_sites`

Discover all sites on the Plausible instance.

| Param | Type | Default |
|---|---|---|
| *(none)* | — | — |

**Compressed output:**
```
Sites on plausible.icjia.cloud (15 found)
  icjia.illinois.gov (America/Chicago)
  researchhub.icjia.dev (America/Chicago)
  accessibility.icjia.app (America/Chicago)
  ...
```

### 6. `get_status`

Server info + health check.

**Compressed output:**
```
plausible-mcp status
  Server:    @icjia/plausible-mcp v0.2.0
  Instance:  https://plausible.icjia.cloud
  Node:      v22.22.0
  Platform:  darwin arm64
  Health:    ✓ connected (12 realtime visitors)
```

---

## Security Requirements (Priority Order)

### 1. Input Validation
- All metrics, dimensions, periods, filter operators validated against allowlists in CONFIG
- **String length caps (reject, don't truncate):**
  - `siteId`: max 253 chars, domain-format only (letters, digits, hyphens, dots — no slashes, no special chars, no directory traversal)
  - `dateRange`: exactly 21 chars (`YYYY-MM-DD,YYYY-MM-DD`), strict ISO 8601
  - `filter`: max 300 chars total, value portion max 200 chars
- Limits clamped 1–50
- Filter values sanitized (control chars, newlines, zero-width stripped)
- `dateRange` REQUIRED when `period === 'custom'` — throw early, don't send invalid request

### 2. Output Sanitization (Prompt Injection Prevention)
- ALL Plausible-sourced strings (page paths, referrers, source names, country names, city names, UTM params) stripped of: control characters (C0/C1), newlines (replaced with spaces), zero-width chars (ZWSP, BOM, directional markers)
- Page paths truncated to 80 chars
- General strings truncated to 200 chars
- This prevents malicious page titles from injecting instructions into Claude's context

### 3. Rate Limiting
- Shared rate limiter used by ALL outbound requests (queryPlausible, checkHealth, listSites)
- 600 requests/hour local safety net
- 3 concurrent request cap
- Request timeout: 15 seconds (AbortController)

### 4. Response Safety
- Response body size cap: 5MB — read as text, check length, then JSON.parse
- Response schema validation: verify `results` is an array of arrays before compression
- For `list_sites`: verify `site_results` is an array of objects with `domain` string

### 5. Error Sanitization
HTTP error codes mapped to specific, actionable messages returned to Claude:

| Code / Error | Message |
|---|---|
| 400 | `Bad request — check query parameters (invalid metric, dimension, or date range).` |
| 401 | `Authentication failed — PLAUSIBLE_API_KEY is missing or invalid.` |
| 403 | `Access denied — API key lacks required scope for this endpoint.` |
| 404 | `Endpoint not found — verify PLAUSIBLE_BASE_URL and that the Plausible instance supports the v2 API.` |
| 422 | `Unprocessable query — Plausible rejected the request. Check site ID and filter syntax.` |
| 429 | `Rate limited by Plausible — too many requests. Wait and retry.` |
| 500 | `Plausible server error — the instance returned an internal error.` |
| 502/503 | `Plausible instance unavailable — check that the server is running.` |
| ECONNREFUSED | `Cannot connect to Plausible at {baseUrl} — is the instance running?` |
| ENOTFOUND | `DNS lookup failed for Plausible host — check PLAUSIBLE_BASE_URL.` |
| AbortError | `Request timed out after 15s — Plausible may be overloaded.` |
| *(other)* | `Query failed — unexpected error. Check server logs (stderr) for details.` |

- API key NEVER appears in any output, error message, or log (first 4 chars + masked in debug)

### 6. No Raw JSON
- Compression engine is the ONLY path from Plausible responses to Claude's context
- Full API responses are never returned

### 7. Base URL Validation (startup)
- `PLAUSIBLE_BASE_URL` must parse as a valid URL
- Scheme must be `https://`. Allow `http://` only for `localhost` / `127.0.0.1` with a stderr warning
- Reject `file://`, `data://`, `ftp://`, and all non-HTTP schemes
- Strip trailing slashes for consistency

### 8. Response Content-Type Check
- Before parsing: check `Content-Type` header matches expected type
- v2 query endpoint: require `application/json`
- v1 realtime: require `text/plain` or `text/html`
- v1 sites: require `application/json`
- Mismatch → reject with `Unexpected response from Plausible — expected JSON, got {content-type}.`

### 9. Cache Integrity
- Only cache responses that pass `validateResponse()`
- Failed/malformed responses are NEVER cached — next request retries live

### 10. Static Code Constraints
- No `eval()`, `new Function()`, or dynamic `import()` anywhere
- `security.test.js` must grep all `src/*.js` files for these patterns and fail if found
- Filter values, page paths, referrer strings are always opaque data, never evaluated

### 11. API Key Protection
- Masked to first 4 chars + `****` in any debug output
- Never in tool responses, error messages, or `get_status` output
- Global `uncaughtException` handler sanitizes env vars before logging to stderr
- Validated as present and non-empty on startup

### 12. Dependency Pinning
- Exact versions in package.json (no `^` or `~` ranges)
- Commit `package-lock.json`
- Update dependencies deliberately, not automatically

---

## Compression Specification

### Principles
1. Zero tokens on empty results
2. Plain text, not JSON (~30% fewer tokens)
3. Short metric labels: Vis, Sess, PV, PV/S, Bounce, Dur, Evt
4. Number formatting: 12.4K, 1.5M (never raw integers above 10K)
5. Duration formatting: 2m14s (never raw seconds)
6. Percentage formatting: 58.3% (one decimal)
7. Path truncation at 80 chars
8. Hard cap: 150 lines / 40,000 chars

### Metric Labels
```
visitors → Vis     visits → Sess      pageviews → PV
views_per_visit → PV/S  bounce_rate → Bounce  visit_duration → Dur
events → Evt
```

### Output Limits
| Limit | Value | Enforced in |
|---|---|---|
| Lines | 150 | compress.js enforceOutputLimits() |
| Characters | 40,000 | compress.js enforceOutputLimits() |
| Page path length | 80 chars | sanitizePath() |
| String length | 200 chars | sanitize() |
| Results per query | 50 | Zod schema + clampLimit() |

---

## Response Caching

All Plausible API responses cached in-memory with a **90-second TTL**.

### Implementation (in runner.js):
```js
const cache = new Map(); // key → { data, timestamp }
const CACHE_TTL = 90_000;
const CACHE_MAX = 100;

function getCacheKey(endpoint, body) {
  // For POST: endpoint + JSON.stringify(body)
  // For GET: full URL with query params
  return `${endpoint}:${typeof body === 'string' ? body : JSON.stringify(body)}`;
}
```

### Rules:
- Cache key = endpoint + request body hash (POST) or full URL (GET)
- On read: if entry exists and `Date.now() - timestamp < CACHE_TTL`, return cached data
- On read: if expired, delete entry and proceed with live request
- On write: if `cache.size >= CACHE_MAX`, delete oldest entry (LRU)
- `get_status` (`checkHealth`) bypasses cache — always a live health check
- Delta queries (prior period fetch in `query_overview`) participate in caching
- Cache is not persisted — cleared on server restart

---

## Filter Parsing Specification

The `filter` param accepts a simplified human-readable string that the server converts to v2 filter arrays.

### Supported formats:
```
"page contains /grants"     → ["contains", "event:page", ["/grants"]]
"page is /"                 → ["is", "event:page", ["/"]]
"source is Google"          → ["is", "visit:source", ["Google"]]
"country is US"             → ["is", "visit:country_name", ["US"]]
"device is Mobile"          → ["is", "visit:device", ["Mobile"]]
"browser is Chrome"         → ["is", "visit:browser", ["Chrome"]]
"os is Mac"                 → ["is", "visit:os", ["Mac"]]
"entry_page contains /blog" → ["contains", "visit:entry_page", ["/blog"]]
```

### Parsing rules:
1. Split on first space to get `property`
2. Split remainder on first space to get `operator`
3. Remainder is `value`
4. Map property shorthand to full dimension: `page` → `event:page`, `source` → `visit:source`, `country` → `visit:country_name`, `device` → `visit:device`, `browser` → `visit:browser`, `os` → `visit:os`, `entry_page` → `visit:entry_page`, `exit_page` → `visit:exit_page`, `referrer` → `visit:referrer`, `utm_source` → `visit:utm_source`, `utm_medium` → `visit:utm_medium`, `utm_campaign` → `visit:utm_campaign`
5. Validate operator against allowlist: `is`, `is_not`, `contains`, `contains_not`
6. Sanitize value (control chars, newlines, zero-width)
7. Return `[operator, dimension, [value]]`

### Security:
- Dimension must map to an allowed dimension or reject
- Operator must be in allowlist or reject
- Value is sanitized and truncated to 200 chars
- Malformed filter strings return a clear error, not a silent pass-through

---

## Build Phases

### Phase 1: Core (config.js, runner.js, compress.js)
- config.js: VERSION from package.json, all constants, env validation (including base URL scheme check, API key presence check), log with proper levels, MAX_SITE_ID_LENGTH=253, MAX_FILTER_LENGTH=300, CACHE_TTL=90000, CACHE_MAX=100
- runner.js: shared rateLimitedFetch, response cache (90s TTL, max 100 entries), queryPlausible, checkHealth, listSites, all validators, all sanitizers, filter parser, response validator, delta period computation (prior-period date range calculator)
- compress.js: compressOverview, compressBreakdown (unified — replaces both compressPages and old compressBreakdown), compressTimeseries, compressMultiSite, compressStatus, compressSites
- Tests: security.test.js (including source grep for eval/Function/dynamic import), compress.test.js

**Deliverable:** `npm test` passes with all validation, sanitization, compression, and filter parsing tests green.

### Phase 2: MCP Server (server.js)
- 6 tool registrations with Zod schemas
- Shared schema definitions (MetricsSchema, PeriodSchema, etc.) — no duplication
- Custom period validation (dateRange required when custom)
- Filter param on all query tools
- VERSION from config.js

**Deliverable:** Server starts via `node src/server.js` with env vars set. Tools listed via MCP inspector.

### Phase 3: CLI (cli.js)
- 6 subcommands: pages, overview, breakdown, timeseries, list-sites, status
- Falls back to MCP server mode when no subcommand
- VERSION from config.js
- All subcommands support --filter flag

**Deliverable:** `plausible-mcp pages icjia.illinois.gov` returns compressed output against live instance.

### Phase 4: Integration Tests + Hardening
- test/integration.test.js: mock HTTP server for all API paths
- test/timeseries.test.js: timeseries compression
- Rate limiter tests
- Response validation tests
- Error code mapping tests
- Timeout tests
- Oversized response tests

**Deliverable:** Full test suite passes. `npm test` runs all test files. Coverage of all critical paths.

### Phase 5: Documentation + Publish
- README.md (comprehensive, following lightcap pattern)
- CLAUDE.md (project instructions for Claude Code)
- CHANGELOG.md
- package.json (final version, bin, files, keywords)
- publish.sh

**Deliverable:** `npm publish --access public` succeeds. `npx @icjia/plausible-mcp --help` works. `claude mcp add` registration verified.

---

## Critical Implementation Notes

1. **MCP SDK import paths:** Use `@modelcontextprotocol/sdk/server/mcp.js` for `McpServer` and `@modelcontextprotocol/sdk/server/stdio.js` for `StdioServerTransport`.

2. **McpServer.tool() signature:** `server.tool(name, description, zodSchemaObject, handler)`. Handler receives params as first argument, returns `{ content: [{ type: 'text', text: '...' }] }`.

3. **Zod schemas in tool registration:** Pass a plain object of Zod types, NOT `z.object(...)`. The SDK wraps it internally.

4. **All console output to stderr:** MCP uses stdout for JSON-RPC. Never `console.log()` — always `console.error()` for debugging.

5. **Error responses from tools:** Return `{ content: [{ type: 'text', text: 'Error: ...' }], isError: true }`.

6. **No build step:** This is plain JavaScript with ES modules. `src/*.js` ships directly to npm. No TypeScript, no bundler.

7. **Test runner:** Node's built-in `node --test`. No jest, no mocha.

8. **`list_sites` uses v1 API** (GET endpoint), while all query tools use v2 (POST endpoint). Different request patterns in runner.js.

9. **The `time` dimension in v2** auto-selects granularity from date_range. For explicit control, use `time:day`, `time:week`, or `time:month`.

10. **Delta computation in `query_overview`:** Requires two v2 API calls — one for the current period, one for the prior period of equal length. Use `date_range` arrays for explicit control: if current is `30d`, compute the prior 30-day window as `["YYYY-MM-DD", "YYYY-MM-DD"]`. Both requests go through `rateLimitedFetch` and caching. If the prior-period request fails (e.g., site didn't exist yet), return metrics without deltas rather than failing the whole call.

11. **Plausible CE version concern:** The v2 API was introduced in Plausible CE around 2024. If Chris's instance is older, it won't have it. `get_status` should report the API version detected. If v2 returns 404, log a warning suggesting an upgrade. Do NOT implement v1 fallback — that's a different project.
