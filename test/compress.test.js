import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatNumber, formatDuration, formatPercent, formatDelta,
  enforceOutputLimits,
  compressOverview, compressBreakdown, compressTimeseries,
  compressSites, compressStatus, compressMultiSite,
} from '../src/compress.js';

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

describe('formatNumber', () => {
  it('formats millions', () => assert.equal(formatNumber(1_500_000), '1.5M'));
  it('formats millions round', () => assert.equal(formatNumber(2_000_000), '2M'));
  it('formats tens of thousands', () => assert.equal(formatNumber(12_400), '12.4K'));
  it('formats thousands', () => assert.equal(formatNumber(1_500), '1.5K'));
  it('formats small numbers', () => assert.equal(formatNumber(42), '42'));
  it('formats zero', () => assert.equal(formatNumber(0), '0'));
  it('handles null', () => assert.equal(formatNumber(null), '0'));
});

describe('formatDuration', () => {
  it('formats seconds only', () => assert.equal(formatDuration(45), '45s'));
  it('formats minutes and seconds', () => assert.equal(formatDuration(134), '2m14s'));
  it('formats exact minutes', () => assert.equal(formatDuration(120), '2m'));
  it('handles zero', () => assert.equal(formatDuration(0), '0s'));
  it('handles null', () => assert.equal(formatDuration(null), '0s'));
});

describe('formatPercent', () => {
  it('formats with one decimal', () => assert.equal(formatPercent(58.3), '58.3%'));
  it('formats zero', () => assert.equal(formatPercent(0), '0.0%'));
  it('handles null', () => assert.equal(formatPercent(null), '0%'));
});

// ---------------------------------------------------------------------------
// Delta formatting
// ---------------------------------------------------------------------------

describe('formatDelta', () => {
  it('shows positive percent for count metric', () => {
    assert.equal(formatDelta('visitors', 1080, 1000), '(+8%)');
  });

  it('shows negative percent for count metric', () => {
    assert.equal(formatDelta('pageviews', 900, 1000), '(-10%)');
  });

  it('shows (=) for no change', () => {
    assert.equal(formatDelta('visitors', 100, 100), '(=)');
  });

  it('shows (new) when prior is zero', () => {
    assert.equal(formatDelta('visitors', 100, 0), '(new)');
  });

  it('shows pp change for bounce_rate', () => {
    assert.equal(formatDelta('bounce_rate', 55.5, 50.0), '(+5.5pp)');
  });

  it('shows negative pp for bounce_rate', () => {
    assert.equal(formatDelta('bounce_rate', 48.0, 50.0), '(-2.0pp)');
  });

  it('shows (=) for tiny pp change', () => {
    assert.equal(formatDelta('bounce_rate', 50.01, 50.0), '(=)');
  });

  it('returns empty string when prior is null', () => {
    assert.equal(formatDelta('visitors', 100, null), '');
  });
});

// ---------------------------------------------------------------------------
// enforceOutputLimits
// ---------------------------------------------------------------------------

describe('enforceOutputLimits', () => {
  it('passes short text through', () => {
    assert.equal(enforceOutputLimits('hello'), 'hello');
  });

  it('truncates lines', () => {
    const lines = Array(200).fill('line').join('\n');
    const result = enforceOutputLimits(lines);
    assert.ok(result.split('\n').length <= 152); // 150 + truncation message
  });

  it('truncates chars', () => {
    const long = 'x'.repeat(50_000);
    const result = enforceOutputLimits(long);
    assert.ok(result.length <= 40_100); // some room for truncation message
  });
});

// ---------------------------------------------------------------------------
// compressOverview
// ---------------------------------------------------------------------------

describe('compressOverview', () => {
  it('compresses aggregate response', () => {
    const response = { results: [[12400, 15800, 42100, 58.3, 134]] };
    const metrics = ['visitors', 'visits', 'pageviews', 'bounce_rate', 'visit_duration'];
    const result = compressOverview('example.com', '30d', metrics, response, null);
    assert.ok(result.includes('example.com'));
    assert.ok(result.includes('[30d]'));
    assert.ok(result.includes('Vis:12.4K'));
    assert.ok(result.includes('Bounce:58.3%'));
    assert.ok(result.includes('Dur:2m14s'));
  });

  it('includes deltas when prior data provided', () => {
    const response = { results: [[1080, 500]] };
    const prior = { results: [[1000, 500]] };
    const metrics = ['visitors', 'pageviews'];
    const result = compressOverview('example.com', '30d', metrics, response, prior);
    assert.ok(result.includes('(+8%)'));
    assert.ok(result.includes('(=)'));
  });

  it('handles empty results', () => {
    const result = compressOverview('example.com', '30d', ['visitors'], { results: [] }, null);
    assert.ok(result.includes('no data'));
  });
});

// ---------------------------------------------------------------------------
// compressBreakdown
// ---------------------------------------------------------------------------

describe('compressBreakdown', () => {
  it('compresses page breakdown', () => {
    const response = { results: [['/', 4200, 8100, 42.1], ['/about', 1800, 2300, 55.0]] };
    const metrics = ['visitors', 'pageviews', 'bounce_rate'];
    const result = compressBreakdown('example.com', '30d', metrics, 'Pages', response, { sort: 'desc' });
    assert.ok(result.includes('Top pages'));
    assert.ok(result.includes('1. /'));
    assert.ok(result.includes('2. /about'));
    assert.ok(result.includes('Vis:4.2K'));
  });

  it('shows Bottom for asc sort', () => {
    const response = { results: [['/dead', 2, 3, 90.0]] };
    const result = compressBreakdown('example.com', '30d', ['visitors'], 'Pages', response, { sort: 'asc' });
    assert.ok(result.includes('Bottom pages'));
  });

  it('handles empty results', () => {
    const result = compressBreakdown('example.com', '30d', ['visitors'], 'Pages', { results: [] });
    assert.ok(result.includes('no data'));
  });

  it('sanitizes page paths', () => {
    const malicious = '/page\x00\u200B<script>';
    const response = { results: [[malicious, 100]] };
    const result = compressBreakdown('example.com', '30d', ['visitors'], 'Pages', response);
    assert.ok(!result.includes('\x00'));
    assert.ok(!result.includes('\u200B'));
  });
});

// ---------------------------------------------------------------------------
// compressSites
// ---------------------------------------------------------------------------

describe('compressSites', () => {
  it('compresses site list', () => {
    const data = {
      site_results: [
        { domain: 'icjia.illinois.gov', timezone: 'America/Chicago' },
        { domain: 'researchhub.icjia.dev', timezone: 'America/Chicago' },
      ]
    };
    const result = compressSites('https://plausible.icjia.cloud', data);
    assert.ok(result.includes('2 found'));
    assert.ok(result.includes('icjia.illinois.gov'));
    assert.ok(result.includes('America/Chicago'));
  });

  it('handles empty list', () => {
    const result = compressSites('https://example.com', { site_results: [] });
    assert.ok(result.includes('No sites'));
  });
});

// ---------------------------------------------------------------------------
// compressStatus
// ---------------------------------------------------------------------------

describe('compressStatus', () => {
  it('compresses status with healthy connection', () => {
    const result = compressStatus({
      packageName: '@icjia/plausible-mcp',
      version: '0.1.0',
      baseUrl: 'https://plausible.icjia.cloud',
      health: { ok: true, realtimeVisitors: 12 },
    });
    assert.ok(result.includes('v0.1.0'));
    assert.ok(result.includes('plausible.icjia.cloud'));
    assert.ok(result.includes('✓ connected'));
    assert.ok(result.includes('12 realtime'));
  });

  it('compresses status with failed connection', () => {
    const result = compressStatus({
      packageName: '@icjia/plausible-mcp',
      version: '0.1.0',
      baseUrl: 'https://plausible.icjia.cloud',
      health: { ok: false, error: 'Connection refused' },
    });
    assert.ok(result.includes('✗'));
    assert.ok(result.includes('Connection refused'));
  });
});

// ---------------------------------------------------------------------------
// compressMultiSite
// ---------------------------------------------------------------------------

describe('compressMultiSite', () => {
  it('compresses multi-site results', () => {
    const results = ['site1.com [30d] Vis:100', 'site2.com [30d] Vis:200'];
    const result = compressMultiSite(results);
    assert.ok(result.includes('2 sites'));
    assert.ok(result.includes('site1.com'));
  });

  it('handles empty', () => {
    assert.ok(compressMultiSite([]).includes('No site data'));
  });
});
