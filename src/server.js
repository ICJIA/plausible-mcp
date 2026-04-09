#!/usr/bin/env node

import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { VERSION, PACKAGE_NAME, CONFIG, ENV, log } from './config.js';
import {
  validateSiteId, validateDateRange, clampLimit, parseFilter,
  queryAggregate, queryBreakdown as queryBreakdownApi, queryTimeseries as queryTimeseriesApi,
  listSites, checkHealth, computePriorPeriodRange,
} from './runner.js';
import {
  compressOverview, compressBreakdown, compressTimeseries,
  compressSites, compressStatus,
} from './compress.js';

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

export function createServer() {
  const server = new McpServer({
    name: 'plausible-mcp',
    version: VERSION,
  });

  // --- query_overview ---
  server.registerTool(
    'query_overview',
    {
      description: 'Aggregate stats for a site with period-over-period deltas. Answers "How is this site doing?"',
      inputSchema: z.object({
        siteId: z.string().optional().describe('Plausible site domain (defaults to PLAUSIBLE_DEFAULT_SITE env var)'),
        period: z.enum(CONFIG.PERIODS).default('30d').describe('Time period: day, 7d, 30d, month, 6mo, 12mo, all, custom'),
        dateRange: z.string().optional().describe('Required when period=custom: "YYYY-MM-DD,YYYY-MM-DD"'),
        metrics: z.array(z.enum(CONFIG.METRICS)).default(['visitors', 'visits', 'pageviews', 'bounce_rate', 'visit_duration']).describe('Metrics to return'),
        filter: z.string().optional().describe('Filter string, e.g. "page contains /grants", "source is Google"'),
      }),
    },
    async (params) => {
      try {
        const siteId = validateSiteId(params.siteId);
        const dateRange = validateDateRange(params.period, params.dateRange);
        const metrics = params.metrics;
        const filter = parseFilter(params.filter);

        const response = await queryAggregate(siteId, {
          metrics, period: params.period, dateRange, filters: filter,
        });

        let priorResponse = null;
        const ranges = computePriorPeriodRange(params.period, params.dateRange);
        if (ranges) {
          try {
            priorResponse = await queryAggregate(siteId, {
              metrics, period: 'custom', dateRange: ranges.prior, filters: filter,
            });
          } catch (err) {
            log('debug', 'Prior period query failed (deltas skipped):', err.message);
          }
        }

        return { content: [{ type: 'text', text: compressOverview(siteId, params.period, metrics, response, priorResponse) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
      }
    }
  );

  // --- query_pages ---
  server.registerTool(
    'query_pages',
    {
      description: 'Top or bottom pages by traffic. Answers "What pages are popular?" or "What pages get no traffic?"',
      inputSchema: z.object({
        siteId: z.string().optional().describe('Plausible site domain'),
        period: z.enum(CONFIG.PERIODS).default('30d').describe('Time period'),
        dateRange: z.string().optional().describe('Required when period=custom'),
        limit: z.number().int().min(1).max(50).default(10).describe('Number of results (1-50)'),
        sort: z.enum(['desc', 'asc']).default('desc').describe('desc=most popular, asc=least popular'),
        metrics: z.array(z.enum(CONFIG.METRICS)).default(['visitors', 'pageviews', 'bounce_rate']).describe('Metrics to return'),
        filter: z.string().optional().describe('Filter string, e.g. "page contains /grants"'),
      }),
    },
    async (params) => {
      try {
        const siteId = validateSiteId(params.siteId);
        const dateRange = validateDateRange(params.period, params.dateRange);
        const limit = clampLimit(params.limit);
        const metrics = params.metrics;
        const filter = parseFilter(params.filter);

        const response = await queryBreakdownApi(siteId, {
          metrics, period: params.period, dateRange,
          property: 'event:page', limit, filters: filter,
        });

        // Sort: v1 API returns desc by default; reverse for asc
        if (params.sort === 'asc' && response.results) {
          response.results.reverse();
        }

        return { content: [{ type: 'text', text: compressBreakdown(siteId, params.period, metrics, 'Pages', response, { sort: params.sort, limit }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
      }
    }
  );

  // --- query_breakdown ---
  server.registerTool(
    'query_breakdown',
    {
      description: 'Break down traffic by any dimension: source, country, device, browser, OS, UTMs, etc.',
      inputSchema: z.object({
        siteId: z.string().optional().describe('Plausible site domain'),
        period: z.enum(CONFIG.PERIODS).default('30d').describe('Time period'),
        dateRange: z.string().optional().describe('Required when period=custom'),
        dimension: z.enum(CONFIG.DIMENSIONS).describe('Dimension to break down by (e.g., visit:source, visit:country_name, visit:device)'),
        limit: z.number().int().min(1).max(50).default(10).describe('Number of results (1-50)'),
        sort: z.enum(['desc', 'asc']).default('desc').describe('Sort order'),
        metrics: z.array(z.enum(CONFIG.METRICS)).default(['visitors', 'pageviews', 'bounce_rate']).describe('Metrics to return'),
        filter: z.string().optional().describe('Filter string'),
      }),
    },
    async (params) => {
      try {
        const siteId = validateSiteId(params.siteId);
        const dateRange = validateDateRange(params.period, params.dateRange);
        const limit = clampLimit(params.limit);
        const metrics = params.metrics;
        const filter = parseFilter(params.filter);

        const response = await queryBreakdownApi(siteId, {
          metrics, period: params.period, dateRange,
          property: params.dimension, limit, filters: filter,
        });

        if (params.sort === 'asc' && response.results) {
          response.results.reverse();
        }

        return { content: [{ type: 'text', text: compressBreakdown(siteId, params.period, metrics, params.dimension, response, { sort: params.sort, limit }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
      }
    }
  );

  // --- query_timeseries ---
  server.registerTool(
    'query_timeseries',
    {
      description: 'Trend data over time. Answers "Is traffic going up or down?"',
      inputSchema: z.object({
        siteId: z.string().optional().describe('Plausible site domain'),
        period: z.enum(CONFIG.PERIODS).default('6mo').describe('Time period'),
        dateRange: z.string().optional().describe('Required when period=custom'),
        interval: z.enum(CONFIG.INTERVALS).default('month').describe('Granularity: day, week, month'),
        metrics: z.array(z.enum(CONFIG.METRICS)).default(['visitors', 'pageviews']).describe('Metrics to return'),
        filter: z.string().optional().describe('Filter string'),
      }),
    },
    async (params) => {
      try {
        const siteId = validateSiteId(params.siteId);
        const dateRange = validateDateRange(params.period, params.dateRange);
        const metrics = params.metrics;
        const filter = parseFilter(params.filter);

        const response = await queryTimeseriesApi(siteId, {
          metrics, period: params.period, dateRange,
          interval: params.interval, filters: filter,
        });

        return { content: [{ type: 'text', text: compressTimeseries(siteId, params.period, params.interval, metrics, response) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
      }
    }
  );

  // --- list_sites ---
  server.registerTool(
    'list_sites',
    {
      description: 'Discover all sites tracked by the Plausible instance.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const data = await listSites();
        return { content: [{ type: 'text', text: compressSites(ENV.baseUrl, data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
      }
    }
  );

  // --- get_status ---
  server.registerTool(
    'get_status',
    {
      description: 'Server info, version, and Plausible instance health check.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const health = await checkHealth();
        return { content: [{ type: 'text', text: compressStatus({
          packageName: PACKAGE_NAME,
          version: VERSION,
          baseUrl: ENV.baseUrl,
          health,
        }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
      }
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// Start server (called from cli.js or directly)
// ---------------------------------------------------------------------------

export async function startServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', `plausible-mcp v${VERSION} running on stdio`);
}
