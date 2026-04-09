import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compressTimeseries } from '../src/compress.js';

describe('compressTimeseries', () => {
  it('compresses monthly timeseries (v1 format)', () => {
    const response = { results: [
      { date: '2025-01-01', visitors: 1200, pageviews: 3400 },
      { date: '2025-02-01', visitors: 1300, pageviews: 3600 },
      { date: '2025-03-01', visitors: 1100, pageviews: 3100 },
    ]};
    const result = compressTimeseries('example.com', '6mo', 'month', ['visitors', 'pageviews'], response);
    assert.ok(result.includes('timeseries [6mo]'));
    assert.ok(result.includes('monthly'));
    assert.ok(result.includes('3 points'));
    assert.ok(result.includes('2025-01-0'));
    assert.ok(result.includes('Vis:1.2K'));
    assert.ok(result.includes('PV:3.4K'));
  });

  it('compresses daily timeseries', () => {
    const response = { results: [
      { date: '2025-06-01', visitors: 50, pageviews: 120 },
      { date: '2025-06-02', visitors: 60, pageviews: 140 },
    ]};
    const result = compressTimeseries('example.com', '7d', 'day', ['visitors', 'pageviews'], response);
    assert.ok(result.includes('daily'));
    assert.ok(result.includes('2 points'));
  });

  it('compresses weekly timeseries', () => {
    const response = { results: [
      { date: '2025-06-02', visitors: 350, pageviews: 800 },
      { date: '2025-06-09', visitors: 400, pageviews: 950 },
    ]};
    const result = compressTimeseries('example.com', '30d', 'week', ['visitors', 'pageviews'], response);
    assert.ok(result.includes('weekly'));
  });

  it('handles empty timeseries', () => {
    const result = compressTimeseries('example.com', '6mo', 'month', ['visitors'], { results: [] });
    assert.ok(result.includes('no data'));
  });

  it('handles single metric', () => {
    const response = { results: [{ date: '2025-01-01', visitors: 500 }] };
    const result = compressTimeseries('example.com', '30d', 'month', ['visitors'], response);
    assert.ok(result.includes('Vis:500'));
  });

  it('formats large numbers with K suffix', () => {
    const response = { results: [{ date: '2025-01-01', visitors: 15000, pageviews: 42000 }] };
    const result = compressTimeseries('example.com', '30d', 'month', ['visitors', 'pageviews'], response);
    assert.ok(result.includes('Vis:15K'));
    assert.ok(result.includes('PV:42K'));
  });
});
