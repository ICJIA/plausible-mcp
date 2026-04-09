import { CONFIG } from './config.js';
import { sanitize, sanitizePath } from './runner.js';

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

export function formatNumber(n) {
  if (n == null || isNaN(n)) return '0';
  const num = Number(n);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 10_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  if (Number.isInteger(num)) return String(num);
  return num.toFixed(1);
}

export function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return '0s';
  const s = Math.round(Number(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m${rem}s` : `${m}m`;
}

export function formatPercent(n) {
  if (n == null || isNaN(n)) return '0%';
  return Number(n).toFixed(1) + '%';
}

function formatMetricValue(metric, value) {
  if (CONFIG.PERCENTAGE_METRICS.includes(metric)) return formatPercent(value);
  if (CONFIG.DURATION_METRICS.includes(metric)) return formatDuration(value);
  return formatNumber(value);
}

function metricLabel(metric) {
  return CONFIG.METRIC_LABELS[metric] || metric;
}

// ---------------------------------------------------------------------------
// Delta formatting
// ---------------------------------------------------------------------------

export function formatDelta(metric, current, prior) {
  if (prior == null || current == null) return '';

  const c = Number(current);
  const p = Number(prior);

  if (CONFIG.PERCENTAGE_METRICS.includes(metric)) {
    const diff = c - p;
    if (Math.abs(diff) < 0.05) return '(=)';
    const sign = diff > 0 ? '+' : '';
    return `(${sign}${diff.toFixed(1)}pp)`;
  }

  if (p === 0 && c > 0) return '(new)';
  if (p === 0 && c === 0) return '(=)';

  const pctChange = ((c - p) / Math.abs(p)) * 100;
  if (Math.abs(pctChange) < 0.5) return '(=)';
  const sign = pctChange > 0 ? '+' : '';
  return `(${sign}${Math.round(pctChange)}%)`;
}

// ---------------------------------------------------------------------------
// Output limits
// ---------------------------------------------------------------------------

export function enforceOutputLimits(text) {
  let lines = text.split('\n');
  if (lines.length > CONFIG.MAX_OUTPUT_LINES) {
    lines = lines.slice(0, CONFIG.MAX_OUTPUT_LINES);
    lines.push(`  ... truncated at ${CONFIG.MAX_OUTPUT_LINES} lines`);
  }
  let result = lines.join('\n');
  if (result.length > CONFIG.MAX_OUTPUT_CHARS) {
    result = result.slice(0, CONFIG.MAX_OUTPUT_CHARS) + '\n  ... truncated at 40K chars';
  }
  return result;
}

// ---------------------------------------------------------------------------
// Compressors — v1 API response formats
// ---------------------------------------------------------------------------

// v1 aggregate response: { results: { metric: { value: N }, ... } }
export function compressOverview(siteId, period, metrics, response, priorResponse) {
  const results = response?.results;
  if (!results || Object.keys(results).length === 0) {
    return `${siteId} [${period}] — no data`;
  }

  const priorResults = priorResponse?.results || null;

  const parts = metrics.map((m) => {
    const val = results[m]?.value ?? null;
    const label = metricLabel(m);
    const formatted = formatMetricValue(m, val);
    const delta = priorResults ? formatDelta(m, val, priorResults[m]?.value) : '';
    return `${label}:${formatted}${delta}`;
  });

  return enforceOutputLimits(`${siteId} [${period}] ${parts.join(' ')}`);
}

// v1 breakdown response: { results: [{ dimension: val, metric1: N, ... }, ...] }
export function compressBreakdown(siteId, period, metrics, dimensionName, response, options = {}) {
  const { sort = 'desc' } = options;
  const rows = response?.results || [];

  if (rows.length === 0) {
    return `${siteId} — ${dimensionName} [${period}] — no data`;
  }

  const label = sort === 'asc' ? 'Bottom' : 'Top';
  const isPage = dimensionName === 'event:page' || dimensionName === 'Pages';

  // Determine the dimension key from the first row (e.g., "page", "source", "country", etc.)
  const dimKey = Object.keys(rows[0]).find(k => !metrics.includes(k)) || 'unknown';
  const displayDimension = isPage ? 'pages' : dimKey;

  const lines = [`${siteId} — ${label} ${displayDimension} [${period}] (${rows.length} shown)`];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const dimValue = isPage ? sanitizePath(String(row[dimKey])) : sanitize(String(row[dimKey]));
    const metricParts = metrics.map((m) => {
      const val = row[m] ?? null;
      return `${metricLabel(m)}:${formatMetricValue(m, val)}`;
    });
    lines.push(`  ${r + 1}. ${dimValue} — ${metricParts.join(' ')}`);
  }

  return enforceOutputLimits(lines.join('\n'));
}

// v1 timeseries response: { results: [{ date: "YYYY-MM-DD", metric1: N, ... }, ...] }
export function compressTimeseries(siteId, period, interval, metrics, response) {
  const rows = response?.results || [];

  if (rows.length === 0) {
    return `${siteId} — timeseries [${period}] — no data`;
  }

  const intervalLabel = interval === 'day' ? 'daily' : interval === 'week' ? 'weekly' : 'monthly';
  const lines = [`${siteId} — timeseries [${period}] (${intervalLabel}, ${rows.length} points)`];

  for (const row of rows) {
    const dateStr = sanitize(String(row.date), 10);
    const metricParts = metrics.map((m) => {
      const val = row[m] ?? null;
      return `${metricLabel(m)}:${formatMetricValue(m, val)}`;
    });
    lines.push(`  ${dateStr}  ${metricParts.join('  ')}`);
  }

  return enforceOutputLimits(lines.join('\n'));
}

export function compressSites(baseUrl, data) {
  const sites = data.site_results || [];
  if (sites.length === 0) return 'No sites found.';

  const host = baseUrl.replace(/^https?:\/\//, '');
  const lines = [`Sites on ${host} (${sites.length} found)`];

  for (const s of sites) {
    const domain = sanitize(s.domain, 100);
    const tz = sanitize(s.timezone || 'unknown', 50);
    lines.push(`  ${domain} (${tz})`);
  }

  return enforceOutputLimits(lines.join('\n'));
}

export function compressStatus(info) {
  const lines = [
    'plausible-mcp status',
    `  Server:    ${info.packageName} v${info.version}`,
    `  Instance:  ${info.baseUrl}`,
    `  Node:      ${process.version}`,
    `  Platform:  ${process.platform} ${process.arch}`,
  ];

  if (info.health) {
    if (info.health.ok) {
      lines.push(`  Health:    ✓ connected (${info.health.realtimeVisitors} realtime visitors)`);
    } else {
      lines.push(`  Health:    ✗ ${info.health.error}`);
    }
  }

  return enforceOutputLimits(lines.join('\n'));
}

export function compressMultiSite(results) {
  if (!results || results.length === 0) return 'No site data.';

  const lines = [`Multi-site overview (${results.length} sites)`];
  for (const r of results) {
    lines.push(`  ${r}`);
  }

  return enforceOutputLimits(lines.join('\n'));
}
