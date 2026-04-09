import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import {
  queryPlausible, listSites, checkHealth, clearCache,
  computePriorPeriodRange, buildQueryBody,
} from '../src/runner.js';

// ---------------------------------------------------------------------------
// Mock HTTP server
// ---------------------------------------------------------------------------

let mockServer;
let mockPort;

function setMockHandler(handler) {
  mockServer._handler = handler;
}

before(async () => {
  // Set env vars to point to our mock server
  mockServer = createHttpServer((req, res) => {
    if (mockServer._handler) {
      mockServer._handler(req, res);
    } else {
      res.writeHead(500);
      res.end('No handler set');
    }
  });
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  mockPort = mockServer.address().port;
  process.env.PLAUSIBLE_BASE_URL = `http://127.0.0.1:${mockPort}`;
  process.env.PLAUSIBLE_API_KEY = 'test-key-1234';
  process.env.PLAUSIBLE_DEFAULT_SITE = 'example.com';
});

after(() => {
  mockServer.close();
});

// ---------------------------------------------------------------------------
// queryPlausible
// ---------------------------------------------------------------------------

describe('queryPlausible', () => {
  it('parses valid v2 aggregate response', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: [[1200, 1500, 55.2]] }));
    });

    const body = { site_id: 'example.com', metrics: ['visitors', 'pageviews', 'bounce_rate'], date_range: '30d' };
    const data = await queryPlausible(body, { skipCache: true });
    assert.deepEqual(data.results, [[1200, 1500, 55.2]]);
  });

  it('parses valid v2 breakdown response', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: [['/', 4200, 8100], ['/about', 1800, 2300]] }));
    });

    const body = { site_id: 'example.com', metrics: ['visitors', 'pageviews'], date_range: '30d', dimensions: ['event:page'] };
    const data = await queryPlausible(body, { skipCache: true });
    assert.equal(data.results.length, 2);
    assert.equal(data.results[0][0], '/');
  });

  it('maps 401 to auth error', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    await assert.rejects(
      () => queryPlausible({ site_id: 'x.com', metrics: ['visitors'], date_range: '30d' }, { skipCache: true }),
      /Authentication failed/
    );
  });

  it('maps 429 to rate limit error', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    await assert.rejects(
      () => queryPlausible({ site_id: 'x.com', metrics: ['visitors'], date_range: '30d' }, { skipCache: true }),
      /Rate limited/
    );
  });

  it('maps 500 to server error', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    await assert.rejects(
      () => queryPlausible({ site_id: 'x.com', metrics: ['visitors'], date_range: '30d' }, { skipCache: true }),
      /server error/
    );
  });

  it('rejects malformed JSON', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('not json');
    });

    await assert.rejects(
      () => queryPlausible({ site_id: 'x.com', metrics: ['visitors'], date_range: '30d' }, { skipCache: true }),
      /Invalid JSON/
    );
  });

  it('rejects invalid response shape (flat array)', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: [1, 2, 3] }));
    });

    await assert.rejects(
      () => queryPlausible({ site_id: 'x.com', metrics: ['visitors'], date_range: '30d' }, { skipCache: true }),
      /not an array/
    );
  });

  it('rejects wrong content-type', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>not plausible</html>');
    });

    await assert.rejects(
      () => queryPlausible({ site_id: 'x.com', metrics: ['visitors'], date_range: '30d' }, { skipCache: true }),
      /Unexpected response/
    );
  });

  it('rejects oversized response', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // 6MB of data
      res.end('x'.repeat(6 * 1024 * 1024));
    });

    await assert.rejects(
      () => queryPlausible({ site_id: 'x.com', metrics: ['visitors'], date_range: '30d' }, { skipCache: true }),
      /too large/
    );
  });

  it('uses cache on second call', async () => {
    clearCache();
    let callCount = 0;
    setMockHandler((req, res) => {
      callCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: [[100]] }));
    });

    const body = { site_id: 'cache-test.com', metrics: ['visitors'], date_range: '30d' };
    await queryPlausible(body);
    await queryPlausible(body); // should hit cache
    assert.equal(callCount, 1);
  });
});

// ---------------------------------------------------------------------------
// listSites
// ---------------------------------------------------------------------------

describe('listSites', () => {
  it('parses valid sites response', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        site_results: [
          { domain: 'icjia.illinois.gov', timezone: 'America/Chicago' },
          { domain: 'researchhub.icjia.dev', timezone: 'America/Chicago' },
        ],
        meta: { limit: 100 }
      }));
    });

    const data = await listSites();
    assert.equal(data.site_results.length, 2);
    assert.equal(data.site_results[0].domain, 'icjia.illinois.gov');
  });

  it('handles 403 gracefully', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(403);
      res.end('');
    });

    await assert.rejects(() => listSites(), /Sites API not available/);
  });
});

// ---------------------------------------------------------------------------
// checkHealth
// ---------------------------------------------------------------------------

describe('checkHealth', () => {
  it('returns realtime visitor count', async () => {
    setMockHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('12');
    });

    const result = await checkHealth('example.com');
    assert.equal(result.ok, true);
    assert.equal(result.realtimeVisitors, 12);
  });

  it('handles connection error gracefully', async () => {
    // Point to a port that definitely isn't listening
    const origUrl = process.env.PLAUSIBLE_BASE_URL;
    process.env.PLAUSIBLE_BASE_URL = 'http://127.0.0.1:1';
    try {
      const result = await checkHealth('example.com');
      assert.equal(result.ok, false);
      assert.ok(result.error);
    } finally {
      process.env.PLAUSIBLE_BASE_URL = origUrl;
    }
  });
});

// ---------------------------------------------------------------------------
// computePriorPeriodRange
// ---------------------------------------------------------------------------

describe('computePriorPeriodRange', () => {
  it('returns null for period=all', () => {
    assert.equal(computePriorPeriodRange('all'), null);
  });

  it('returns null for period=custom', () => {
    assert.equal(computePriorPeriodRange('custom'), null);
  });

  it('returns date ranges for 30d', () => {
    const result = computePriorPeriodRange('30d');
    assert.ok(result);
    assert.ok(result.current);
    assert.ok(result.prior);
    assert.equal(result.current.length, 2);
    assert.equal(result.prior.length, 2);
    // Verify dates are ISO format
    assert.match(result.current[0], /^\d{4}-\d{2}-\d{2}$/);
    assert.match(result.prior[0], /^\d{4}-\d{2}-\d{2}$/);
  });

  it('prior end is day before current start for 7d', () => {
    const result = computePriorPeriodRange('7d');
    const currentStart = new Date(result.current[0] + 'T00:00:00Z');
    const priorEnd = new Date(result.prior[1] + 'T00:00:00Z');
    const diff = currentStart.getTime() - priorEnd.getTime();
    assert.equal(diff, 86_400_000); // exactly 1 day gap
  });
});

// ---------------------------------------------------------------------------
// buildQueryBody
// ---------------------------------------------------------------------------

describe('buildQueryBody', () => {
  it('builds basic aggregate body', () => {
    const body = buildQueryBody('example.com', {
      metrics: ['visitors', 'pageviews'],
      period: '30d',
    });
    assert.equal(body.site_id, 'example.com');
    assert.deepEqual(body.metrics, ['visitors', 'pageviews']);
    assert.equal(body.date_range, '30d');
    assert.equal(body.dimensions, undefined);
  });

  it('builds breakdown body with dimensions', () => {
    const body = buildQueryBody('example.com', {
      metrics: ['visitors'],
      period: '30d',
      dimensions: ['event:page'],
      limit: 10,
      orderBy: [['visitors', 'desc']],
    });
    assert.deepEqual(body.dimensions, ['event:page']);
    assert.equal(body.limit, 10);
    assert.deepEqual(body.order_by, [['visitors', 'desc']]);
  });

  it('includes filter when provided', () => {
    const body = buildQueryBody('example.com', {
      metrics: ['visitors'],
      period: '30d',
      filters: ['contains', 'event:page', ['/grants']],
    });
    assert.deepEqual(body.filters, [['contains', 'event:page', ['/grants']]]);
  });

  it('uses custom date range', () => {
    const body = buildQueryBody('example.com', {
      metrics: ['visitors'],
      period: 'custom',
      dateRange: ['2025-01-01', '2025-01-31'],
    });
    assert.deepEqual(body.date_range, ['2025-01-01', '2025-01-31']);
  });
});
