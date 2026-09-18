import path from 'node:path';
import { createSellviaClient } from './sellvia.js';
import { createShopifyClient } from './shopify.js';
import {
  parseBoolean,
  parseScope,
  runSync,
  writeReportFiles,
} from './core.js';

function readCliOptions(argv) {
  const options = {};
  for (const argument of argv) {
    if (!argument.startsWith('--')) continue;
    const [key, rawValue] = argument.slice(2).split('=');
    options[key] = rawValue ?? 'true';
  }
  return options;
}

function buildConfig(env, cliOptions) {
  const requestedDryRun = parseBoolean(cliOptions['dry-run'] ?? env.SYNC_DRY_RUN, true);
  const writeApproved = parseBoolean(env.SHOPIFY_SELLVIA_WRITE_APPROVED, false);
  const dryRun = requestedDryRun || !writeApproved;
  const scope = parseScope(cliOptions.scope ?? env.SYNC_SCOPE ?? 'all');
  const reportDir = env.SYNC_REPORT_DIR || path.join(process.cwd(), '.sync-reports');
  const maxRuntimeMs = Number(env.SYNC_MAX_RUNTIME_MS || 15 * 60 * 1000);
  const deadlineAt = Date.now() + (Number.isFinite(maxRuntimeMs) ? maxRuntimeMs : 15 * 60 * 1000);

  return {
    requestedDryRun,
    writeApproved,
    dryRun,
    scope,
    reportDir,
    reportPath: env.SYNC_REPORT_PATH,
    summaryPath: env.SYNC_SUMMARY_PATH,
    historyPath: env.SYNC_HISTORY_PATH,
    pageSize: Number(env.SYNC_PAGE_SIZE || 100),
    publishProducts: parseBoolean(env.SHOPIFY_SELLVIA_PUBLISH_PRODUCTS, false),
    enableOrderSync: parseBoolean(env.SHOPIFY_SELLVIA_ENABLE_ORDER_SYNC, false),
    shopifyStoreDomain: env.SHOPIFY_STORE_DOMAIN,
    shopifyAccessToken: env.SHOPIFY_ADMIN_ACCESS_TOKEN || env.SHOPIFY_API_TOKEN,
    shopifyLocationId: env.SHOPIFY_LOCATION_ID || null,
    shopifyProductsFixturePath: env.SHOPIFY_PRODUCTS_FIXTURE_PATH || '',
    sellviaBaseUrl: env.SELLVIA_API_BASE_URL || 'https://api.sellvia.com',
    sellviaAccessToken: env.SELLVIA_API_KEY || env.SELLVIA_MASTER_KEY,
    sellviaCatalogEndpoint: env.SELLVIA_CATALOG_ENDPOINT || '',
    sellviaOrderEndpoint: env.SELLVIA_ORDER_ENDPOINT || '',
    catalogFixturePath: env.SELLVIA_CATALOG_FIXTURE_PATH || '',
    requestRuntime: {
      deadlineAt,
      timeoutMs: Number(env.SYNC_REQUEST_TIMEOUT_MS || 15_000),
      maxAttempts: Number(env.SYNC_MAX_ATTEMPTS || 4),
      baseDelayMs: Number(env.SYNC_RETRY_DELAY_MS || 1_000),
      log: (message) => console.log(`[sync] ${message}`),
    },
  };
}

async function main() {
  const cliOptions = readCliOptions(process.argv.slice(2));
  const config = buildConfig(process.env, cliOptions);

  let report;
  try {
    report = await runSync({
      config,
      shopifyClient: createShopifyClient(config),
      sellviaClient: createSellviaClient(config),
    });
  } catch (error) {
    report = {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'failed',
      exitCode: 1,
      scope: [...config.scope],
      requestedDryRun: config.requestedDryRun,
      effectiveDryRun: config.dryRun,
      writeApproved: config.writeApproved,
      protection: config.dryRun
        ? config.requestedDryRun
          ? 'Dry-run requested'
          : 'Write approval missing; dry-run enforced'
        : 'Write mode enabled with explicit approval',
      counts: {
        fetched: { sellviaProducts: 0, shopifyProducts: 0 },
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 1,
      },
      blockers: [],
      warnings: [],
      operations: [
        {
          status: 'failed',
          identity: 'runtime',
          reason: error instanceof Error ? error.message : String(error),
        },
      ],
      diagnostics: {},
    };
  }

  const paths = await writeReportFiles(report, {
    reportDir: config.reportDir,
    reportPath: config.reportPath,
    summaryPath: config.summaryPath,
    historyPath: config.historyPath,
  });

  console.log(`[sync] Summary written to ${paths.summaryPath}`);
  console.log(`[sync] Report written to ${paths.reportPath}`);

  process.exit(report.exitCode || 0);
}

main().catch((error) => {
  console.error('[sync] Unexpected fatal error', error);
  process.exit(1);
});
