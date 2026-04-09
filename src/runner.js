import { CONFIG, ENV, maskApiKey, log } from './config.js';

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

const requestLog = [];
let activeRequests = 0;

function checkRateLimit() {
  const now = Date.now();
  // Prune entries older than the window
  while (requestLog.length > 0 && requestLog[0] < now - CONFIG.RATE_LIMIT_WINDOW) {
    requestLog.shift();
  }
  if (requestLog.length >= CONFIG.RATE_LIMIT_MAX) {
    throw new Error('Rate limit exceeded — 600 requests/hour cap reached. Wait and retry.');
  }
  if (activeRequests >= CONFIG.CONCURRENCY_MAX) {
    throw new Error('Concurrency limit exceeded — 3 concurrent requests max. Wait and retry.');
  }
}

function recordRequest() {
  requestLog.push(Date.now());
  activeRequests++;
}

function releaseRequest() {
  activeRequests--;
}

// ---------------------------------------------------------------------------
// Response cache (90s TTL)
// ---------------------------------------------------------------------------

const cache = new Map();

function getCacheKey(endpoint, body) {
  return `${endpoint}:${typeof body === 'object' ? JSON.stringify(body) : String(body || '')}`;
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CONFIG.CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  if (cache.size >= CONFIG.CACHE_MAX) {
    // Delete oldest entry (first key)
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { data, timestamp: Date.now() });
}

// Exported for testing
export function clearCache() { cache.clear(); }

// ---------------------------------------------------------------------------
// Input validators
// ---------------------------------------------------------------------------

const SITE_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,251}[a-zA-Z0-9]$/;

export function validateSiteId(siteId) {
  if (!siteId) {
    const def = ENV.defaultSite;
    if (!def) throw new Error('siteId is required — no PLAUSIBLE_DEFAULT_SITE configured.');
    return def;
  }
  if (typeof siteId !== 'string') throw new Error('siteId must be a string.');
  if (siteId.length > CONFIG.MAX_SITE_ID_LENGTH) throw new Error(`siteId exceeds max length of ${CONFIG.MAX_SITE_ID_LENGTH}.`);
  if (siteId.length < 2) throw new Error('siteId is too short.');
  if (!SITE_ID_REGEX.test(siteId)) throw new Error('siteId contains invalid characters — domain format only (letters, digits, hyphens, dots).');
  return siteId;
}

export function validateDateRange(period, dateRange) {
  if (period === 'custom') {
    if (!dateRange) throw new Error('dateRange is required when period is "custom".');
    if (typeof dateRange !== 'string' || dateRange.length !== CONFIG.DATE_RANGE_LENGTH) {
      throw new Error('dateRange must be "YYYY-MM-DD,YYYY-MM-DD" (exactly 21 characters).');
    }
    const parts = dateRange.split(',');
    if (parts.length !== 2) throw new Error('dateRange must contain exactly one comma: "YYYY-MM-DD,YYYY-MM-DD".');
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    for (const p of parts) {
      if (!dateRegex.test(p)) throw new Error(`Invalid date in dateRange: "${p}". Use ISO 8601 (YYYY-MM-DD).`);
      const d = new Date(p + 'T00:00:00Z');
      if (isNaN(d.getTime())) throw new Error(`Invalid date in dateRange: "${p}".`);
    }
    return [parts[0], parts[1]];
  }
  return period;
}

export function clampLimit(limit) {
  if (limit == null) return 10;
  const n = Math.floor(Number(limit));
  if (isNaN(n)) return 10;
  return Math.max(1, Math.min(n, CONFIG.MAX_RESULTS));
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

// Strip control chars, zero-width chars, newlines
const CONTROL_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;
const ZERO_WIDTH_REGEX = /[\u200B\u200C\u200D\uFEFF\u2060\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;

export function sanitize(str, maxLen = CONFIG.MAX_STRING_LENGTH) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(CONTROL_REGEX, '')
    .replace(ZERO_WIDTH_REGEX, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function sanitizePath(str) {
  return sanitize(str, CONFIG.MAX_PATH_LENGTH);
}

// ---------------------------------------------------------------------------
// Filter parser
// ---------------------------------------------------------------------------

export function parseFilter(filterStr) {
  if (!filterStr) return null;
  if (typeof filterStr !== 'string') throw new Error('filter must be a string.');
  if (filterStr.length > CONFIG.MAX_FILTER_LENGTH) throw new Error(`filter exceeds max length of ${CONFIG.MAX_FILTER_LENGTH}.`);

  // Split: "page contains /grants"
  const firstSpace = filterStr.indexOf(' ');
  if (firstSpace === -1) throw new Error('Invalid filter format. Expected: "property operator value" (e.g., "page contains /grants").');
  const property = filterStr.slice(0, firstSpace);
  const rest = filterStr.slice(firstSpace + 1);

  const secondSpace = rest.indexOf(' ');
  if (secondSpace === -1) throw new Error('Invalid filter format. Expected: "property operator value" (e.g., "page contains /grants").');
  const operator = rest.slice(0, secondSpace);
  const value = rest.slice(secondSpace + 1);

  // Map property
  const dimension = CONFIG.FILTER_DIMENSION_MAP[property];
  if (!dimension) throw new Error(`Unknown filter property: "${property}". Allowed: ${Object.keys(CONFIG.FILTER_DIMENSION_MAP).join(', ')}.`);

  // Validate operator
  if (!CONFIG.FILTER_OPERATORS.includes(operator)) {
    throw new Error(`Unknown filter operator: "${operator}". Allowed: ${CONFIG.FILTER_OPERATORS.join(', ')}.`);
  }

  // Sanitize value
  const cleanValue = sanitize(value, CONFIG.MAX_FILTER_VALUE_LENGTH);
  if (!cleanValue) throw new Error('Filter value is empty after sanitization.');

  return [operator, dimension, [cleanValue]];
}

// ---------------------------------------------------------------------------
// Response validation
// ---------------------------------------------------------------------------

export function validateQueryResponse(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid response: expected an object.');
  if (!Array.isArray(data.results)) throw new Error('Invalid response: "results" is not an array.');
  for (let i = 0; i < data.results.length; i++) {
    if (!Array.isArray(data.results[i])) {
      throw new Error(`Invalid response: results[${i}] is not an array.`);
    }
  }
  return data;
}

export function validateSitesResponse(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid sites response: expected an object.');
  if (!Array.isArray(data.site_results)) throw new Error('Invalid sites response: "site_results" is not an array.');
  for (let i = 0; i < data.site_results.length; i++) {
    const site = data.site_results[i];
    if (!site || typeof site.domain !== 'string') {
      throw new Error(`Invalid sites response: site_results[${i}] missing "domain" string.`);
    }
  }
  return data;
}

function validateContentType(response, expected) {
  const ct = response.headers.get('content-type') || '';
  const lower = ct.toLowerCase();
  for (const exp of expected) {
    if (lower.includes(exp)) return;
  }
  throw new Error(`Unexpected response from Plausible — expected ${expected.join(' or ')}, got "${ct}". Verify PLAUSIBLE_BASE_URL points to a Plausible instance.`);
}

// ---------------------------------------------------------------------------
// HTTP client (rate-limited, cached)
// ---------------------------------------------------------------------------

async function rateLimitedFetch(url, options = {}) {
  checkRateLimit();
  recordRequest();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
    releaseRequest();
  }
}

function mapHttpError(status, baseUrl) {
  const msg = CONFIG.ERROR_MESSAGES[status];
  if (msg) return msg;
  return 'Query failed — unexpected error. Check server logs (stderr) for details.';
}

function mapNetworkError(err, baseUrl) {
  if (err.name === 'AbortError') return 'Request timed out after 15s — Plausible may be overloaded.';
  if (err.code === 'ECONNREFUSED') return `Cannot connect to Plausible at ${baseUrl} — is the instance running?`;
  if (err.code === 'ENOTFOUND') return 'DNS lookup failed for Plausible host — check PLAUSIBLE_BASE_URL.';
  return 'Query failed — unexpected error. Check server logs (stderr) for details.';
}

// ---------------------------------------------------------------------------
// Plausible v2 Query API
// ---------------------------------------------------------------------------

export async function queryPlausible(body, { skipCache = false } = {}) {
  const baseUrl = ENV.baseUrl;
  const apiKey = ENV.apiKey;
  const endpoint = `${baseUrl}/api/v2/query`;
  const cacheKey = getCacheKey(endpoint, body);

  if (!skipCache) {
    const cached = getCached(cacheKey);
    if (cached) {
      log('debug', 'Cache hit:', cacheKey.slice(0, 80));
      return cached;
    }
  }

  let response;
  try {
    response = await rateLimitedFetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(mapNetworkError(err, baseUrl));
  }

  if (!response.ok) {
    const msg = mapHttpError(response.status, baseUrl);
    log('warn', `Plausible API error: ${response.status} for ${endpoint}`);
    throw new Error(msg);
  }

  validateContentType(response, ['application/json']);

  const text = await response.text();
  if (text.length > CONFIG.MAX_RESPONSE_BYTES) {
    throw new Error('Response too large — exceeded 5MB safety limit.');
  }

  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Invalid JSON in Plausible response.'); }

  validateQueryResponse(data);

  setCache(cacheKey, data);
  return data;
}

// ---------------------------------------------------------------------------
// Plausible v1 Sites API
// ---------------------------------------------------------------------------

export async function listSites() {
  const baseUrl = ENV.baseUrl;
  const apiKey = ENV.apiKey;
  const endpoint = `${baseUrl}/api/v1/sites?limit=100`;
  const cacheKey = getCacheKey(endpoint, null);

  const cached = getCached(cacheKey);
  if (cached) return cached;

  let response;
  try {
    response = await rateLimitedFetch(endpoint, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
  } catch (err) {
    throw new Error(mapNetworkError(err, baseUrl));
  }

  if (response.status === 403) {
    throw new Error('Sites API not available — list sites manually or check API key scope.');
  }
  if (!response.ok) {
    throw new Error(mapHttpError(response.status, baseUrl));
  }

  validateContentType(response, ['application/json']);

  const text = await response.text();
  if (text.length > CONFIG.MAX_RESPONSE_BYTES) {
    throw new Error('Response too large — exceeded 5MB safety limit.');
  }

  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Invalid JSON in Plausible sites response.'); }

  validateSitesResponse(data);

  setCache(cacheKey, data);
  return data;
}

// ---------------------------------------------------------------------------
// Plausible v1 Realtime (health check — no cache)
// ---------------------------------------------------------------------------

export async function checkHealth(siteId) {
  const baseUrl = ENV.baseUrl;
  const apiKey = ENV.apiKey;
  const resolvedSite = siteId || ENV.defaultSite;
  const endpoint = resolvedSite
    ? `${baseUrl}/api/v1/stats/realtime/visitors?site_id=${encodeURIComponent(resolvedSite)}`
    : `${baseUrl}/api/v1/stats/realtime/visitors`;

  let response;
  try {
    response = await rateLimitedFetch(endpoint, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
  } catch (err) {
    return { ok: false, error: mapNetworkError(err, baseUrl) };
  }

  if (!response.ok) {
    return { ok: false, error: mapHttpError(response.status, baseUrl) };
  }

  validateContentType(response, ['text/plain', 'text/html', 'application/json']);

  const text = await response.text();
  const visitors = parseInt(text.trim(), 10);
  return { ok: true, realtimeVisitors: isNaN(visitors) ? 0 : visitors, siteId: resolvedSite };
}

// ---------------------------------------------------------------------------
// Delta: compute prior period date range
// ---------------------------------------------------------------------------

export function computePriorPeriodRange(period, dateRange) {
  // Skip delta for these
  if (period === 'all' || period === 'custom') return null;

  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  let days;
  switch (period) {
    case 'day': days = 1; break;
    case '7d': days = 7; break;
    case '30d': days = 30; break;
    case 'month': {
      // Current month so far
      const startOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      const daysSoFar = Math.ceil((today - startOfMonth) / 86_400_000) + 1;
      days = daysSoFar;
      break;
    }
    case '6mo': days = 180; break;
    case '12mo': days = 365; break;
    default: return null;
  }

  // Current period: [today - days + 1, today]
  const currentEnd = today;
  const currentStart = new Date(currentEnd.getTime() - (days - 1) * 86_400_000);

  // Prior period: [currentStart - days, currentStart - 1]
  const priorEnd = new Date(currentStart.getTime() - 86_400_000);
  const priorStart = new Date(priorEnd.getTime() - (days - 1) * 86_400_000);

  const fmt = (d) => d.toISOString().slice(0, 10);
  return {
    current: [fmt(currentStart), fmt(currentEnd)],
    prior: [fmt(priorStart), fmt(priorEnd)],
  };
}

// ---------------------------------------------------------------------------
// Build v2 query body
// ---------------------------------------------------------------------------

export function buildQueryBody(siteId, { metrics, period, dateRange, dimensions, filters, orderBy, limit }) {
  const body = { site_id: siteId, metrics };
  body.date_range = dateRange || period;
  if (dimensions && dimensions.length > 0) body.dimensions = dimensions;
  if (filters) body.filters = [filters];
  if (orderBy) body.order_by = orderBy;
  if (limit != null) body.limit = limit;
  return body;
}
