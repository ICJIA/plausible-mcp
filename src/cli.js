#!/usr/bin/env node

import { Command } from 'commander';
import { VERSION, ENV, log } from './config.js';
import {
  validateSiteId, validateDateRange, clampLimit, parseFilter,
  queryPlausible, listSites, checkHealth,
  buildQueryBody, computePriorPeriodRange,
} from './runner.js';
import {
  compressOverview, compressBreakdown, compressTimeseries,
  compressSites, compressStatus,
} from './compress.js';
import { PACKAGE_NAME } from './config.js';

const program = new Command();

program
  .name('plausible-mcp')
  .description('Query self-hosted Plausible Analytics from the command line or as an MCP server')
  .version(VERSION);

// --- overview ---
program
  .command('overview [siteId]')
  .description('Aggregate stats for a site with deltas')
  .option('-p, --period <period>', 'Time period', '30d')
  .option('--date-range <range>', 'Custom date range: YYYY-MM-DD,YYYY-MM-DD')
  .option('-m, --metrics <metrics...>', 'Metrics', ['visitors', 'visits', 'pageviews', 'bounce_rate', 'visit_duration'])
  .option('-f, --filter <filter>', 'Filter string')
  .action(async (siteId, opts) => {
    try {
      const site = validateSiteId(siteId);
      const dateRange = validateDateRange(opts.period, opts.dateRange);
      const filter = parseFilter(opts.filter);
      const body = buildQueryBody(site, {
        metrics: opts.metrics, period: opts.period, dateRange, filters: filter,
      });
      const response = await queryPlausible(body);

      let priorResponse = null;
      const ranges = computePriorPeriodRange(opts.period, opts.dateRange);
      if (ranges) {
        try {
          const priorBody = buildQueryBody(site, {
            metrics: opts.metrics, period: 'custom', dateRange: ranges.prior, filters: filter,
          });
          priorResponse = await queryPlausible(priorBody);
        } catch { /* skip deltas */ }
      }

      console.log(compressOverview(site, opts.period, opts.metrics, response, priorResponse));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// --- pages ---
program
  .command('pages [siteId]')
  .description('Top or bottom pages by traffic')
  .option('-p, --period <period>', 'Time period', '30d')
  .option('--date-range <range>', 'Custom date range')
  .option('-l, --limit <n>', 'Number of results', '10')
  .option('-s, --sort <order>', 'Sort order: desc or asc', 'desc')
  .option('-m, --metrics <metrics...>', 'Metrics', ['visitors', 'pageviews', 'bounce_rate'])
  .option('-f, --filter <filter>', 'Filter string')
  .action(async (siteId, opts) => {
    try {
      const site = validateSiteId(siteId);
      const dateRange = validateDateRange(opts.period, opts.dateRange);
      const limit = clampLimit(parseInt(opts.limit, 10));
      const filter = parseFilter(opts.filter);
      const orderBy = [[opts.metrics[0], opts.sort]];
      const body = buildQueryBody(site, {
        metrics: opts.metrics, period: opts.period, dateRange,
        dimensions: ['event:page'], filters: filter, orderBy, limit,
      });
      const response = await queryPlausible(body);
      console.log(compressBreakdown(site, opts.period, opts.metrics, 'Pages', response, { sort: opts.sort, limit }));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// --- breakdown ---
program
  .command('breakdown [siteId]')
  .description('Break down traffic by dimension')
  .requiredOption('-d, --dimension <dim>', 'Dimension (e.g., visit:source, visit:country_name)')
  .option('-p, --period <period>', 'Time period', '30d')
  .option('--date-range <range>', 'Custom date range')
  .option('-l, --limit <n>', 'Number of results', '10')
  .option('-s, --sort <order>', 'Sort order', 'desc')
  .option('-m, --metrics <metrics...>', 'Metrics', ['visitors', 'pageviews', 'bounce_rate'])
  .option('-f, --filter <filter>', 'Filter string')
  .action(async (siteId, opts) => {
    try {
      const site = validateSiteId(siteId);
      const dateRange = validateDateRange(opts.period, opts.dateRange);
      const limit = clampLimit(parseInt(opts.limit, 10));
      const filter = parseFilter(opts.filter);
      const orderBy = [[opts.metrics[0], opts.sort]];
      const body = buildQueryBody(site, {
        metrics: opts.metrics, period: opts.period, dateRange,
        dimensions: [opts.dimension], filters: filter, orderBy, limit,
      });
      const response = await queryPlausible(body);
      console.log(compressBreakdown(site, opts.period, opts.metrics, opts.dimension, response, { sort: opts.sort, limit }));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// --- timeseries ---
program
  .command('timeseries [siteId]')
  .description('Trend data over time')
  .option('-p, --period <period>', 'Time period', '6mo')
  .option('--date-range <range>', 'Custom date range')
  .option('-i, --interval <interval>', 'Granularity: day, week, month', 'month')
  .option('-m, --metrics <metrics...>', 'Metrics', ['visitors', 'pageviews'])
  .option('-f, --filter <filter>', 'Filter string')
  .action(async (siteId, opts) => {
    try {
      const site = validateSiteId(siteId);
      const dateRange = validateDateRange(opts.period, opts.dateRange);
      const filter = parseFilter(opts.filter);
      const timeDim = `time:${opts.interval}`;
      const body = buildQueryBody(site, {
        metrics: opts.metrics, period: opts.period, dateRange,
        dimensions: [timeDim], filters: filter,
      });
      const response = await queryPlausible(body);
      console.log(compressTimeseries(site, opts.period, opts.interval, opts.metrics, response));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// --- list-sites ---
program
  .command('list-sites')
  .description('Discover all sites on the Plausible instance')
  .action(async () => {
    try {
      const data = await listSites();
      console.log(compressSites(ENV.baseUrl, data));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// --- status ---
program
  .command('status')
  .description('Server info and health check')
  .action(async () => {
    try {
      const health = await checkHealth();
      console.log(compressStatus({
        packageName: PACKAGE_NAME,
        version: VERSION,
        baseUrl: ENV.baseUrl,
        health,
      }));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// Default: start MCP server
// ---------------------------------------------------------------------------

async function main() {
  // If no subcommand given, start MCP server
  if (process.argv.length <= 2) {
    const { startServer } = await import('./server.js');
    await startServer();
    return;
  }
  program.parse();
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
