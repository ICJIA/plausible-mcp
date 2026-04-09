import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import {
  queryAggregate, queryBreakdown, queryTimeseries,
  listSites, checkHealth, clearCache,
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
// queryAggregate (v1)
// ---------------------------------------------------------------------------

describe('queryAggregate', () => {
  it('parses valid v1 aggregate response', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: { visitors: { value: 1200 }, pageviews: { value: 1500 }, bounce_rate: { value: 55.2 } } }));
    });

    const data = await queryAggregate('example.com', { metrics: ['visitors', 'pageviews', 'bounce_rate'], period: '30d' });
    assert.equal(data.results.visitors.value, 1200);
    assert.equal(data.results.bounce_rate.value, 55.2);
  });

  it('maps 401 to auth error', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    await assert.rejects(
      () => queryAggregate('x.com', { metrics: ['visitors'], period: '30d' }),
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
      () => queryAggregate('x.com', { metrics: ['visitors'], period: '30d' }),
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
      () => queryAggregate('x.com', { metrics: ['visitors'], period: '30d' }),
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
      () => queryAggregate('x.com', { metrics: ['visitors'], period: '30d' }),
      /Invalid JSON/
    );
  });

  it('rejects wrong content-type', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>not plausible</html>');
    });

    await assert.rejects(
      () => queryAggregate('x.com', { metrics: ['visitors'], period: '30d' }),
      /Unexpected response/
    );
  });

  it('rejects oversized response', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('x'.repeat(6 * 1024 * 1024));
    });

    await assert.rejects(
      () => queryAggregate('x.com', { metrics: ['visitors'], period: '30d' }),
      /too large/
    );
  });

  it('uses cache on second call', async () => {
    clearCache();
    let callCount = 0;
    setMockHandler((req, res) => {
      callCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: { visitors: { value: 100 } } }));
    });

    await queryAggregate('cache-test.com', { metrics: ['visitors'], period: '30d' });
    await queryAggregate('cache-test.com', { metrics: ['visitors'], period: '30d' });
    assert.equal(callCount, 1);
  });
});

// ---------------------------------------------------------------------------
// queryBreakdown (v1)
// ---------------------------------------------------------------------------

describe('queryBreakdown', () => {
  it('parses valid v1 breakdown response', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: [
        { page: '/', visitors: 4200, pageviews: 8100 },
        { page: '/about', visitors: 1800, pageviews: 2300 },
      ]}));
    });

    const data = await queryBreakdown('example.com', { metrics: ['visitors', 'pageviews'], period: '30d', property: 'event:page', limit: 10 });
    assert.equal(data.results.length, 2);
    assert.equal(data.results[0].page, '/');
  });
});

// ---------------------------------------------------------------------------
// queryTimeseries (v1)
// ---------------------------------------------------------------------------

describe('queryTimeseries', () => {
  it('parses valid v1 timeseries response', async () => {
    clearCache();
    setMockHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: [
        { date: '2025-01-01', visitors: 1200, pageviews: 3400 },
        { date: '2025-02-01', visitors: 1300, pageviews: 3600 },
      ]}));
    });

    const data = await queryTimeseries('example.com', { metrics: ['visitors', 'pageviews'], period: '6mo', interval: 'month' });
    assert.equal(data.results.length, 2);
    assert.equal(data.results[0].date, '2025-01-01');
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
    const origUrl = process.env.PLAUSIBLE_BASE_URL;
    process.env.PLAUSIBLE_BASE_URL = 'http://127.0.0.1:1';
    try {
      const result = await checkHealth('example.com');
      assert.equal(result.ok, false);
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
    assert.equal(result.current.length, 2);
    assert.equal(result.prior.length, 2);
    assert.match(result.current[0], /^\d{4}-\d{2}-\d{2}$/);
  });

  it('prior end is day before current start for 7d', () => {
    const result = computePriorPeriodRange('7d');
    const currentStart = new Date(result.current[0] + 'T00:00:00Z');
    const priorEnd = new Date(result.prior[1] + 'T00:00:00Z');
    assert.equal(currentStart.getTime() - priorEnd.getTime(), 86_400_000);
  });
});
