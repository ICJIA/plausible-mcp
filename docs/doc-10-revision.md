# Doc 10 — Revision & Gap Analysis: @icjia/plausible-mcp

## Overview

This document catalogues findings from an adversarial red/blue team audit of the v0.1.0 scaffold and specifies the required fix for each. All findings must be resolved before Doc 07 (Build Prompt) is considered implementation-ready.

---

## CRITICAL — Functional Bugs

### F-01: v2 Response Format Mismatch (compressOverview)

**Finding:** `compressOverview` assumed aggregate (no-dimension) responses return `{ results: [[m1, m2, ...]] }` (nested). The Plausible v2 API returns `{ results: [[m1, m2, ...]] }` for ALL queries — aggregate and breakdown alike. Each row is always an array: `[dim1?, dim2?, metric1, metric2, ...]`. For aggregate queries with no dimensions, `results` contains a single row with only metric values: `[[12400, 15800, 42100]]`.

**Fix:** The compressOverview function was coincidentally correct in structure but the code had a redundant fallback on line 105 (`row[i] !== undefined ? row[i] : response?.results?.[0]?.[i]`) that checked the same reference twice. Simplify to `const val = row[i] ?? null;`. Add a response shape validator that verifies `results` is an array of arrays before entering any compressor.

**Test:** Mock responses must use the documented v2 format: `{ results: [[val1, val2]] }` for aggregate, `{ results: [["page1", val1, val2], ["page2", val1, val2]] }` for breakdown.

### F-02: `period=custom` Without `dateRange` Sends Invalid Request

**Finding:** If Claude calls `query_pages` with `period: "custom"` but omits `dateRange`, the body sends `date_range: "custom"` to Plausible, which returns a 400. The Zod schema makes `dateRange` optional unconditionally.

**Fix:** Add early validation in each handler: if `period === 'custom'` and `dateRange` is falsy, throw `'dateRange is required when period is "custom".'` before building the request body.

---

## HIGH — Security Gaps

### S-01: `checkHealth` Bypasses Rate Limiter

**Finding:** `queryPlausible()` is rate-limited (600/hr, 3 concurrent). `checkHealth()` calls `fetch` directly with no rate tracking. Repeated `get_status` calls could exhaust Plausible's rate limit untracked.

**Fix:** Extract a shared `rateLimitedFetch(url, options)` function used by both `queryPlausible` and `checkHealth`. Or: count `checkHealth` calls in the same `requestLog`.

### S-02: No Response Body Size Cap

**Finding:** `response.json()` parses arbitrarily large payloads. A compromised Plausible instance (or DNS rebind to a malicious server) could return a multi-MB response.

**Fix:** Read response as `response.text()` first. Check `text.length <= CONFIG.MAX_RESPONSE_BYTES`. If exceeded, throw. Then `JSON.parse(text)`.

### S-03: No Response Schema Validation

**Finding:** Compressors trust `response.results` blindly. Malformed responses produce silent garbage.

**Fix:** Add `validateResponse(data)` that checks: (a) `data` is an object, (b) `data.results` is an array, (c) each element of `data.results` is an array. Throw a clear error on shape mismatch.

### S-04: No Base URL Validation

**Finding:** `PLAUSIBLE_BASE_URL` is used directly in `fetch()` calls with no scheme validation. A misconfigured value like `file:///etc/passwd` or `http://169.254.169.254/metadata` could cause SSRF or local file access.

**Fix:** On startup, validate URL parses correctly and scheme is `https://`. Allow `http://` only for `localhost`/`127.0.0.1` with a stderr warning. Reject all non-HTTP schemes.

### S-05: No Response Content-Type Check

**Finding:** Responses are parsed as JSON without checking `Content-Type`. DNS rebinding or a misconfigured proxy could return HTML/XML that `JSON.parse` might partially process or that leaks into error messages.

**Fix:** Check `Content-Type` header before parsing. v2 must be `application/json`. Mismatch → reject with a clear error identifying the unexpected type.

### S-06: No Input Length Caps on Strings

**Finding:** `siteId` and `filter` are validated against format/allowlists but have no maximum length. Absurdly long strings that pass format checks could cause resource exhaustion.

**Fix:** `siteId` max 253 chars (DNS max). `dateRange` exactly 21 chars. `filter` max 300 chars. Reject (don't truncate) oversized inputs.

### S-07: API Key Leak via Uncaught Exceptions

**Finding:** Node's default `uncaughtException` behavior may dump the environment or stack frames containing the API key to stderr.

**Fix:** Install global `uncaughtException`/`unhandledRejection` handlers that sanitize `process.env` references. Mask key to first 4 chars + `****` everywhere, including debug logs.

### S-08: Cache Poisoning

**Finding:** With the 90s response cache, a malformed or malicious response would be served from cache repeatedly until TTL expires.

**Fix:** Only cache responses that pass `validateResponse()`. Failed validations are returned as errors but never cached.

### S-09: No Static Code Constraint Enforcement

**Finding:** No mechanism prevents future contributors from introducing `eval()`, `new Function()`, or dynamic `import()` — all of which could evaluate attacker-influenced strings (filter values, page paths).

**Fix:** `security.test.js` must grep all `src/*.js` files for `eval(`, `new Function(`, and dynamic `import(` patterns. Test fails if any match is found.

### S-10: Dependency Ranges Allow Supply Chain Compromise

**Finding:** Caret ranges (`^1.29.0`) in package.json allow automatic adoption of compromised minor/patch versions. The MCP server has API key access and runs in the user's terminal.

**Fix:** Pin exact versions in package.json. Commit `package-lock.json`. Update dependencies deliberately.

---

## MEDIUM — Missing Features (v1 scope)

### M-01: No `list_sites` Tool

**Rationale:** Multi-site sweeps are the killer feature for ICJIA's 15+ properties. Without site discovery, Claude must be told the list every time.

**API:** `GET /api/v1/sites` with `Bearer` auth. Returns `{ "site_results": [{ "domain": "...", "timezone": "..." }, ...] }` (paginated). Note: on self-hosted CE, this may require the Sites API scope.

**Tool spec:** `list_sites` — no required params. Returns compressed list: one line per site with domain and timezone. Rate-limited through the shared mechanism.

**Fallback:** If the Sites API returns 403 (scope not available on CE), return a clear error: "Sites API not available — list sites manually or upgrade API key scope."

### M-02: No Timeseries Tool

**Rationale:** "How has traffic trended over the last 6 months?" is fundamental. Without timeseries, no trend analysis is possible.

**API:** Use the v2 query endpoint with `dimensions: ["time:month"]` (or `time:day`, `time:week`). Returns `{ results: [["2025-01", 1200, 1500], ["2025-02", 1300, 1600], ...] }`.

**Tool spec:** `query_timeseries` — params: `siteId`, `period`, `dateRange`, `interval` (enum: `day`, `week`, `month`; default: `month`), `metrics`. Returns compressed timeseries: one line per time bucket with date and metrics.

**Compression:** Compact format:
```
icjia.illinois.gov — timeseries [6mo] (monthly)
  2025-01  Vis:1.2K  PV:3.4K  Bounce:55.2%
  2025-02  Vis:1.3K  PV:3.6K  Bounce:53.1%
  ...
```

### M-03: No Filter Support

**Rationale:** "Traffic to pages containing /grants" or "organic traffic only" requires filters. Without them, Claude can only look at unfiltered top-level breakdowns.

**API:** v2 filters are arrays: `["contains", "event:page", ["/grants"]]`. Multiple filters use `["and", [filter1], [filter2]]`.

**Implementation:** Add an optional `filter` param to `query_pages`, `query_overview`, `query_breakdown`, and `query_timeseries`. Accept a simplified string format that the server parses into v2 filter arrays:
- `"page contains /grants"` → `["contains", "event:page", ["/grants"]]`
- `"source is Google"` → `["is", "visit:source", ["Google"]]`
- `"country is US"` → `["is", "visit:country_name", ["US"]]`

Support all four operators: `is`, `is_not`, `contains`, `contains_not`. Implementation cost is negligible and `is_not`/`contains_not` are needed for exclusion queries (e.g., "traffic NOT from Google"). Validate dimension names against the allowlist. Sanitize filter values (same control char / newline / zero-width stripping).

---

### M-04: Response Caching (90s TTL)

**Rationale:** Repeated queries to the same site/period within a conversation are common (especially during iterative analysis). Without caching, each call burns a rate limit slot and adds latency.

**Implementation:** In-memory cache in runner.js. Key = endpoint + body hash. 90-second TTL. Max 100 entries with LRU eviction. `checkHealth` bypasses cache. Delta queries (prior-period fetch) participate in caching.

### M-05: Computed Deltas (Period-over-Period)

**Rationale:** "Is traffic up or down?" is the most common question. Without deltas, Claude must request a timeseries and compute the comparison itself. A single `query_overview` call should answer this directly.

**Implementation:** `query_overview` makes two v2 API calls — current period + prior period of equal length. Deltas formatted inline: `Vis:12.4K(+8%)`. Count metrics show relative %, percentage metrics show absolute pp change, durations show relative %. Skipped for `period=all` and `period=custom`. If prior-period fetch fails, return metrics without deltas (graceful degradation).

### M-06: Error Message Table

**Rationale:** Generic error messages ("Query failed") give Claude nothing to work with. Specific messages let Claude help the user debug.

**Implementation:** Map HTTP status codes and connection errors to specific, actionable messages. See doc-07 § Error Sanitization for the full table.

---

## LOW — Redundancies & Hygiene

### L-01: Double Validation (Zod + runner validators)

**Fix:** Keep Zod for the MCP path, keep runner validators for the CLI path. In MCP handlers, remove redundant `validatePeriod` / `validateMetrics` calls since Zod already enforced the enums. Keep `validateSiteId` (domain format check) and `clampLimit` (these add validation Zod doesn't cover). Keep `validateDateRange` (Zod only checks string length).

### L-02: MetricsSchema Defined Twice

**Fix:** Define `MetricsSchema` once at module level. For `query_overview`, override only the `.default()`:
```js
const OverviewMetricsSchema = MetricsSchema.default(['visitors', 'visits', 'pageviews', 'bounce_rate', 'visit_duration']);
```

### L-03: compressPages and compressBreakdown Nearly Identical

**Fix:** Merge into a single `compressBreakdown(siteId, period, metrics, dimensions, response, options)` function. `options.label` defaults to dimension name. `options.sanitizer` defaults to `sanitize(val, 60)` but for `event:page` dimensions uses `sanitizePath`. Delete `compressPages` as a separate export.

### L-04: compressMultiSite Dead Code

**Fix:** Keep it — it'll be used when `list_sites` enables autonomous multi-site sweeps. Add a test for it.

### L-05: Version Hardcoded in Three Places

**Fix:** Read version from package.json via `import` (as shown in new config.js). Use `VERSION` constant in server.js and cli.js. Single source of truth.

### L-06: `log('warn')` Works by Accident

**Fix:** In the `log` function, explicitly handle warn level: suppress in quiet mode, show in normal and verbose.

---

## Test Requirements

### T-01: Integration Tests with Mock HTTP Server

Create `test/integration.test.js` using Node's built-in `http.createServer`. Mock Plausible v2 responses for:
- Aggregate query (no dimensions) — verify correct metric extraction
- Breakdown query (with dimensions) — verify dimension + metric extraction  
- Error responses (401, 429, 500) — verify safe message mapping
- Timeout — verify AbortController fires
- Oversized response — verify rejection at MAX_RESPONSE_BYTES
- Malformed JSON — verify error handling

### T-02: Rate Limiter Tests

Test `requestLog` pruning, 600/hr cap, concurrency cap, and that `checkHealth` participates in rate limiting.

### T-03: Response Validation Tests

Test `validateResponse` against: valid shapes, `null`, `{}`, `{ results: "string" }`, `{ results: [1, 2, 3] }` (flat instead of nested).

### T-04: Timeseries Compression Tests

Test compact timeseries format with mock monthly/daily data.

### T-05: Filter Parsing Tests

Test simplified filter string → v2 filter array conversion. Test injection attempts in filter values.

### T-06: Base URL Validation Tests

Test that `https://plausible.icjia.cloud` passes. Test that `file:///etc/passwd`, `data:text/html,...`, `ftp://evil.com`, and `http://169.254.169.254` are rejected. Test that `http://localhost:8000` passes with warning.

### T-07: Content-Type Validation Tests

Test that `application/json` responses are accepted. Test that `text/html`, `application/xml`, and missing content-type are rejected with clear error messages.

### T-08: Static Code Constraint Tests

Grep all `src/*.js` files for `eval(`, `new Function(`, `import(` (dynamic). Fail if any match found. This test is a guardrail against future regressions.

### T-09: Input Length Cap Tests

Test that `siteId` > 253 chars is rejected. Test that `filter` > 300 chars is rejected. Test that `dateRange` != 21 chars is rejected. Verify rejection (not truncation).

### T-10: Cache Integrity Tests

Test that valid responses are cached and served on re-request within 90s. Test that failed/malformed responses are NOT cached. Test that cache evicts after 90s TTL. Test LRU eviction at 100 entries.

### T-11: Delta Computation Tests

Test delta formatting for count metrics (+8%), percentage metrics (+1.2pp), duration metrics (+12%). Test zero prior period → `(new)`. Test no change → `(=)`. Test `period=all` skips delta. Test graceful degradation when prior-period fetch fails.

---

## Architecture Changes Summary

### Files to modify:
- `config.js` — add VERSION from package.json, fix log levels, add MAX_RESPONSE_BYTES, add time dimensions, add filter operators, remove dead constants
- `runner.js` — shared rate-limited fetch, response cache (90s TTL), response size cap, response validation, filter parsing, `listSites()` function, delta period computation
- `compress.js` — merge compressPages into compressBreakdown, add compressTimeseries, simplify compressOverview with delta formatting, test compressMultiSite
- `server.js` — add list_sites and query_timeseries tools, fix MetricsSchema duplication, add filter param to all query tools, fix custom period validation, use VERSION constant
- `cli.js` — add timeseries and list-sites subcommands, use VERSION constant

### Files to add:
- `test/integration.test.js` — mock HTTP server tests
- `test/timeseries.test.js` — timeseries compression tests

### Tool count: 4 → 6
1. `query_pages` — top/bottom pages (unchanged concept, now with filter support)
2. `query_overview` — aggregate stats (unchanged concept, now with filter support)  
3. `query_breakdown` — dimension breakdown (unchanged concept, now with filter support)
4. `query_timeseries` — **NEW** — trend data over time
5. `list_sites` — **NEW** — discover all sites on the instance
6. `get_status` — server info + health check (unchanged)
