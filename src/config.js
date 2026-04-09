import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

export const VERSION = pkg.version;
export const PACKAGE_NAME = pkg.name;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function validateBaseUrl(raw) {
  if (!raw) throw new Error('PLAUSIBLE_BASE_URL is required.');
  let url;
  try { url = new URL(raw); } catch { throw new Error(`PLAUSIBLE_BASE_URL is not a valid URL: ${raw}`); }
  if (url.protocol === 'https:') { /* ok */ }
  else if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    log('warn', 'PLAUSIBLE_BASE_URL uses http:// — acceptable for local dev only.');
  } else {
    throw new Error(`PLAUSIBLE_BASE_URL must use https:// (got ${url.protocol}). http:// is only allowed for localhost.`);
  }
  return raw.replace(/\/+$/, '');
}

function validateApiKey(key) {
  if (!key || key.trim().length === 0) throw new Error('PLAUSIBLE_API_KEY is required and must be non-empty.');
  return key.trim();
}

export function maskApiKey(key) {
  if (!key || key.length < 4) return '****';
  return key.slice(0, 4) + '****';
}

export const ENV = {
  get baseUrl() { return validateBaseUrl(process.env.PLAUSIBLE_BASE_URL); },
  get apiKey() { return validateApiKey(process.env.PLAUSIBLE_API_KEY); },
  get defaultSite() { return process.env.PLAUSIBLE_DEFAULT_SITE || null; },
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONFIG = {
  // Rate limiting
  RATE_LIMIT_WINDOW: 3_600_000,
  RATE_LIMIT_MAX: 600,
  CONCURRENCY_MAX: 3,
  REQUEST_TIMEOUT: 15_000,

  // Response safety
  MAX_RESPONSE_BYTES: 5 * 1024 * 1024,

  // Input length caps
  MAX_SITE_ID_LENGTH: 253,
  MAX_FILTER_LENGTH: 300,
  MAX_FILTER_VALUE_LENGTH: 200,
  DATE_RANGE_LENGTH: 21,

  // Cache
  CACHE_TTL: 90_000,
  CACHE_MAX: 100,

  // Compression
  MAX_OUTPUT_LINES: 150,
  MAX_OUTPUT_CHARS: 40_000,
  MAX_PATH_LENGTH: 80,
  MAX_STRING_LENGTH: 200,
  MAX_RESULTS: 50,

  // Allowed values
  METRICS: ['visitors', 'visits', 'pageviews', 'views_per_visit', 'bounce_rate', 'visit_duration', 'events'],
  PERIODS: ['day', '7d', '30d', 'month', '6mo', '12mo', 'all', 'custom'],
  DIMENSIONS: [
    'event:page', 'visit:source', 'visit:referrer',
    'visit:country_name', 'visit:region', 'visit:city',
    'visit:device', 'visit:browser', 'visit:os',
    'visit:entry_page', 'visit:exit_page',
    'visit:utm_source', 'visit:utm_medium', 'visit:utm_campaign',
    'visit:utm_term', 'visit:utm_content',
  ],
  FILTER_OPERATORS: ['is', 'is_not', 'contains', 'contains_not'],
  INTERVALS: ['day', 'week', 'month'],
  TIME_DIMENSIONS: ['time:day', 'time:week', 'time:month'],

  // Filter shorthand → full dimension
  FILTER_DIMENSION_MAP: {
    page: 'event:page',
    source: 'visit:source',
    referrer: 'visit:referrer',
    country: 'visit:country_name',
    region: 'visit:region',
    city: 'visit:city',
    device: 'visit:device',
    browser: 'visit:browser',
    os: 'visit:os',
    entry_page: 'visit:entry_page',
    exit_page: 'visit:exit_page',
    utm_source: 'visit:utm_source',
    utm_medium: 'visit:utm_medium',
    utm_campaign: 'visit:utm_campaign',
    utm_term: 'visit:utm_term',
    utm_content: 'visit:utm_content',
  },

  // Metric labels for compression
  METRIC_LABELS: {
    visitors: 'Vis',
    visits: 'Sess',
    pageviews: 'PV',
    views_per_visit: 'PV/S',
    bounce_rate: 'Bounce',
    visit_duration: 'Dur',
    events: 'Evt',
  },

  // Percentage metrics (show pp delta, not % delta)
  PERCENTAGE_METRICS: ['bounce_rate', 'views_per_visit'],
  // Duration metrics (format as Xm Ys)
  DURATION_METRICS: ['visit_duration'],

  // Error messages
  ERROR_MESSAGES: {
    400: 'Bad request — check query parameters (invalid metric, dimension, or date range).',
    401: 'Authentication failed — PLAUSIBLE_API_KEY is missing or invalid.',
    403: 'Access denied — API key lacks required scope for this endpoint.',
    404: 'Endpoint not found — verify PLAUSIBLE_BASE_URL and that the Plausible instance supports the v2 API.',
    422: 'Unprocessable query — Plausible rejected the request. Check site ID and filter syntax.',
    429: 'Rate limited by Plausible — too many requests. Wait and retry.',
    500: 'Plausible server error — the instance returned an internal error.',
    502: 'Plausible instance unavailable — check that the server is running.',
    503: 'Plausible instance unavailable — check that the server is running.',
  },
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const LOG_LEVEL = (process.env.PLAUSIBLE_LOG_LEVEL || 'normal').toLowerCase();

export function log(level, ...args) {
  if (LOG_LEVEL === 'quiet' && level !== 'error') return;
  if (LOG_LEVEL === 'normal' && level === 'debug') return;
  console.error(`[plausible-mcp:${level}]`, ...args);
}

// ---------------------------------------------------------------------------
// Global safety: catch uncaught exceptions, sanitize env
// ---------------------------------------------------------------------------

function sanitizeForLog(obj) {
  if (typeof obj === 'string') {
    const key = ENV.apiKey;
    if (key && obj.includes(key)) return obj.replaceAll(key, maskApiKey(key));
    return obj;
  }
  return obj;
}

process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception:', sanitizeForLog(err.message));
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled rejection:', sanitizeForLog(String(reason)));
  process.exit(1);
});
