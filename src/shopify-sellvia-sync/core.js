import fs from 'node:fs/promises';
import path from 'node:path';

export const PRODUCT_SCOPES = ['catalog', 'inventory', 'price'];
export const ALL_SCOPES = ['catalog', 'inventory', 'price', 'orders'];
export const MANAGED_TAG = 'sellvia:managed';
export const SOURCE_TAG = 'sellvia:source:catalog';
export const ID_TAG_PREFIX = 'sellvia:id:';

export function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

export function parseScope(value) {
  if (!value || value === 'all') {
    return new Set(ALL_SCOPES);
  }

  const entries = String(value)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const scope = new Set();
  for (const entry of entries) {
    if (entry === 'all') {
      for (const item of ALL_SCOPES) scope.add(item);
      continue;
    }

    if (!ALL_SCOPES.includes(entry)) {
      throw new Error(`Unsupported sync scope: ${entry}`);
    }

    scope.add(entry);
  }

  return scope.size ? scope : new Set(ALL_SCOPES);
}

export function toNullableString(value) {
  if (value === undefined || value === null) return null;
  const stringValue = String(value).trim();
  return stringValue ? stringValue : null;
}

export function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function toNullableInteger(value) {
  const numeric = toNullableNumber(value);
  return numeric === null ? null : Math.trunc(numeric);
}

function firstValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return null;
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeImages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((image) => {
      if (typeof image === 'string') return image.trim();
      if (image && typeof image === 'object') {
        return toNullableString(image.src || image.url || image.href);
      }
      return null;
    })
    .filter(Boolean);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function normalizeStatus(value) {
  const normalized = toNullableString(value)?.toLowerCase();
  if (!normalized) return null;
  if (['active', 'published', 'enabled'].includes(normalized)) return 'active';
  if (['draft', 'pending', 'disabled'].includes(normalized)) return 'draft';
  if (['archived', 'archive'].includes(normalized)) return 'archived';
  return null;
}

export function normalizeSellviaProduct(rawProduct) {
  const externalId = toNullableString(
    firstValue(
      rawProduct.externalId,
      rawProduct.external_id,
      rawProduct.sellviaId,
      rawProduct.sellvia_id,
      rawProduct.product_id,
      rawProduct.id,
    ),
  );
  const sku = toNullableString(
    firstValue(
      rawProduct.sku,
      rawProduct.SKU,
      rawProduct.variantSku,
      rawProduct.variant_sku,
      rawProduct.supplierSku,
      rawProduct.supplier_sku,
    ),
  );
  const title = toNullableString(firstValue(rawProduct.title, rawProduct.name, rawProduct.product_name));
  const price = toNullableNumber(firstValue(rawProduct.price, rawProduct.sale_price, rawProduct.retail_price));
  const compareAtPrice = toNullableNumber(
    firstValue(rawProduct.compare_at_price, rawProduct.compareAtPrice, rawProduct.msrp),
  );
  const inventoryQuantity = toNullableInteger(
    firstValue(
      rawProduct.inventory_quantity,
      rawProduct.inventory,
      rawProduct.stock,
      rawProduct.available,
      rawProduct.quantity,
    ),
  );
  const description = toNullableString(firstValue(rawProduct.description, rawProduct.body_html, rawProduct.bodyHtml));
  const vendor = toNullableString(firstValue(rawProduct.vendor, rawProduct.brand, 'Sellvia'));
  const productType = toNullableString(firstValue(rawProduct.product_type, rawProduct.productType, rawProduct.category));
  const status = normalizeStatus(firstValue(rawProduct.status, rawProduct.state));
  const tags = normalizeTags(rawProduct.tags);
  const images = normalizeImages(rawProduct.images);

  if (!title) {
    throw new Error('Sellvia product is missing a title/name');
  }

  if (!externalId && !sku) {
    throw new Error(`Sellvia product "${title}" is missing both externalId and sku`);
  }

  if (price !== null && price < 0) {
    throw new Error(`Sellvia product "${title}" has a negative price`);
  }

  return {
    externalId,
    sku,
    title,
    description,
    vendor,
    productType,
    price,
    compareAtPrice,
    inventoryQuantity,
    status,
    tags,
    images,
    handle: toNullableString(rawProduct.handle) || slugify(`${title}-${externalId || sku || 'sellvia'}`),
    raw: rawProduct,
  };
}

export function productIdentityKey(product) {
  return product.externalId ? `sellvia:${product.externalId}` : `sku:${product.sku}`;
}

function productTags(product) {
  return normalizeTags(product.tags);
}

function parseSellviaIdFromTags(tags) {
  return tags.find((tag) => tag.startsWith(ID_TAG_PREFIX))?.slice(ID_TAG_PREFIX.length) || null;
}

export function buildShopifyIndex(products) {
  const productsBySellviaId = new Map();
  const variantsBySku = new Map();

  for (const product of products) {
    const tags = productTags(product);
    const sellviaId = parseSellviaIdFromTags(tags);
    if (sellviaId) {
      const existing = productsBySellviaId.get(sellviaId) || [];
      existing.push(product);
      productsBySellviaId.set(sellviaId, existing);
    }

    for (const variant of product.variants || []) {
      const sku = toNullableString(variant.sku);
      if (!sku) continue;
      const existing = variantsBySku.get(sku) || [];
      existing.push({ product, variant });
      variantsBySku.set(sku, existing);
    }
  }

  return { productsBySellviaId, variantsBySku };
}

function resolveVariantForProduct(product, sku) {
  const variants = product.variants || [];
  if (!variants.length) return null;
  if (sku) {
    const exact = variants.find((variant) => toNullableString(variant.sku) === sku);
    if (exact) return exact;
  }
  return variants.length === 1 ? variants[0] : null;
}

export function resolveShopifyMatch(product, index) {
  const idCandidates = product.externalId ? index.productsBySellviaId.get(product.externalId) || [] : [];
  const skuCandidates = product.sku ? index.variantsBySku.get(product.sku) || [] : [];

  if (idCandidates.length > 1) {
    return {
      type: 'conflict',
      reason: `Multiple Shopify products are tagged with Sellvia id ${product.externalId}`,
    };
  }

  if (skuCandidates.length > 1) {
    return {
      type: 'conflict',
      reason: `Multiple Shopify variants share sku ${product.sku}`,
    };
  }

  const idProduct = idCandidates[0] || null;
  const skuEntry = skuCandidates[0] || null;

  if (idProduct && skuEntry && idProduct.id !== skuEntry.product.id) {
    return {
      type: 'conflict',
      reason: `Sellvia id ${product.externalId} and sku ${product.sku} resolve to different Shopify products`,
    };
  }

  if (idProduct) {
    const variant = resolveVariantForProduct(idProduct, product.sku);
    if (!variant) {
      return {
        type: 'conflict',
        reason: `Shopify product ${idProduct.id} matched by Sellvia id ${product.externalId} does not have a deterministic variant match`,
      };
    }

    return { type: 'matched', product: idProduct, variant };
  }

  if (skuEntry) {
    return { type: 'matched', product: skuEntry.product, variant: skuEntry.variant };
  }

  return { type: 'missing' };
}

function mergeManagedTags(existingTags, product) {
  const merged = new Set([...normalizeTags(existingTags), ...product.tags, MANAGED_TAG, SOURCE_TAG]);
  if (product.externalId) {
    merged.add(`${ID_TAG_PREFIX}${product.externalId}`);
  }
  return [...merged].sort();
}

function formatPrice(value) {
  return value === null || value === undefined ? undefined : value.toFixed(2);
}

export function planCatalogUpdate(sourceProduct, shopifyProduct, shopifyVariant, config) {
  const changes = { product: {}, variant: {} };
  const existingTags = productTags(shopifyProduct);
  const desiredTags = mergeManagedTags(existingTags, sourceProduct);

  if (shopifyProduct.title !== sourceProduct.title) changes.product.title = sourceProduct.title;
  if ((shopifyProduct.body_html || '') !== (sourceProduct.description || '')) {
    changes.product.body_html = sourceProduct.description || '';
  }
  if ((shopifyProduct.vendor || '') !== (sourceProduct.vendor || '')) changes.product.vendor = sourceProduct.vendor || '';
  if ((shopifyProduct.product_type || '') !== (sourceProduct.productType || '')) {
    changes.product.product_type = sourceProduct.productType || '';
  }
  if ((shopifyProduct.handle || '') !== sourceProduct.handle) changes.product.handle = sourceProduct.handle;
  if (existingTags.sort().join(',') !== desiredTags.join(',')) changes.product.tags = desiredTags.join(', ');
  if (config.publishProducts && sourceProduct.status && shopifyProduct.status !== sourceProduct.status) {
    changes.product.status = sourceProduct.status;
  }

  if ((shopifyVariant.sku || '') !== (sourceProduct.sku || '')) {
    changes.variant.sku = sourceProduct.sku || '';
  }

  return changes;
}

export function hasCatalogChanges(changes) {
  return Object.keys(changes.product).length > 0 || Object.keys(changes.variant).length > 0;
}

export function buildCreatePayload(sourceProduct, config) {
  const payload = {
    title: sourceProduct.title,
    body_html: sourceProduct.description || '',
    vendor: sourceProduct.vendor || 'Sellvia',
    product_type: sourceProduct.productType || '',
    handle: sourceProduct.handle,
    status: config.publishProducts && sourceProduct.status ? sourceProduct.status : 'draft',
    tags: mergeManagedTags([], sourceProduct).join(', '),
    variants: [
      {
        price: formatPrice(sourceProduct.price ?? 0),
        compare_at_price: formatPrice(sourceProduct.compareAtPrice),
        sku: sourceProduct.sku || '',
        inventory_management: 'shopify',
      },
    ],
  };

  if (sourceProduct.images.length) {
    payload.images = sourceProduct.images.map((src) => ({ src }));
  }

  return payload;
}

export function validateConfig(config) {
  const blockers = [];
  const productScopeEnabled = PRODUCT_SCOPES.some((scope) => config.scope.has(scope));
  const orderOnlyScope = config.scope.size === 1 && config.scope.has('orders');

  if (productScopeEnabled) {
    if (!config.shopifyProductsFixturePath && !config.shopifyStoreDomain) blockers.push('Missing SHOPIFY_STORE_DOMAIN');
    if (!config.shopifyProductsFixturePath && !config.shopifyAccessToken) {
      blockers.push('Missing Shopify admin token (SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_API_TOKEN)');
    }
    if (!config.sellviaAccessToken) blockers.push('Missing Sellvia token (SELLVIA_API_KEY or SELLVIA_MASTER_KEY)');
    if (!config.sellviaCatalogEndpoint && !config.catalogFixturePath) {
      blockers.push('Missing SELLVIA_CATALOG_ENDPOINT (or SELLVIA_CATALOG_FIXTURE_PATH for local validation)');
    }
  }

  if (orderOnlyScope && (!config.enableOrderSync || !config.sellviaOrderEndpoint)) {
    blockers.push(
      'Order-only runs are blocked until SHOPIFY_SELLVIA_ENABLE_ORDER_SYNC=true and SELLVIA_ORDER_ENDPOINT are both configured.',
    );
  }

  return blockers;
}

function createReport(config) {
  return {
    startedAt: new Date().toISOString(),
    requestedDryRun: config.requestedDryRun,
    effectiveDryRun: config.dryRun,
    writeApproved: config.writeApproved,
    scope: [...config.scope],
    protection: config.dryRun
      ? config.requestedDryRun
        ? 'Dry-run requested'
        : 'Write approval missing; dry-run enforced'
      : 'Write mode enabled with explicit approval',
    counts: {
      fetched: {
        sellviaProducts: 0,
        shopifyProducts: 0,
      },
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    },
    blockers: [],
    warnings: [],
    operations: [],
    diagnostics: {},
  };
}

function recordOperation(report, operation) {
  report.operations.push(operation);
}

function count(report, field) {
  report.counts[field] += 1;
}

function summarizeSkippedReason(report, reason, identity) {
  count(report, 'skipped');
  recordOperation(report, { status: 'skipped', identity, reason });
}

export async function runSync({ config, shopifyClient, sellviaClient }) {
  const report = createReport(config);
  report.blockers.push(...validateConfig(config));

  if (report.blockers.length) {
    report.finishedAt = new Date().toISOString();
    report.status = 'failed';
    report.exitCode = 1;
    return report;
  }

  const productScopeEnabled = PRODUCT_SCOPES.some((scope) => config.scope.has(scope));
  let normalizedProducts = [];
  let shopifyProducts = [];
  let locationId = config.shopifyLocationId || null;

  if (productScopeEnabled) {
    const sellviaProducts = await sellviaClient.listCatalogProducts();
    report.counts.fetched.sellviaProducts = sellviaProducts.length;

    for (const rawProduct of sellviaProducts) {
      try {
        normalizedProducts.push(normalizeSellviaProduct(rawProduct));
      } catch (error) {
        count(report, 'failed');
        recordOperation(report, {
          status: 'failed',
          identity: toNullableString(rawProduct?.id) || toNullableString(rawProduct?.sku) || 'unknown',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    shopifyProducts = await shopifyClient.listProducts();
    report.counts.fetched.shopifyProducts = shopifyProducts.length;

    if (config.scope.has('inventory')) {
      locationId = await shopifyClient.getPrimaryLocationId();
      report.diagnostics.locationId = locationId;
    }
  }

  let index = buildShopifyIndex(shopifyProducts);

  for (const sourceProduct of normalizedProducts) {
    const identity = productIdentityKey(sourceProduct);
    let match = resolveShopifyMatch(sourceProduct, index);

    if (match.type === 'conflict') {
      count(report, 'failed');
      recordOperation(report, { status: 'failed', identity, reason: match.reason });
      continue;
    }

    if (match.type === 'missing') {
      if (!config.scope.has('catalog')) {
        count(report, 'failed');
        recordOperation(report, {
          status: 'failed',
          identity,
          reason: 'No existing Shopify product matched and catalog scope is disabled',
        });
        continue;
      }

      if (config.dryRun) {
        count(report, 'created');
        recordOperation(report, { status: 'created', identity, dryRun: true, title: sourceProduct.title });
        if (config.scope.has('inventory')) {
          summarizeSkippedReason(report, 'Inventory update deferred until product exists', `${identity}:inventory`);
        }
        continue;
      }

      const createdProduct = await shopifyClient.createProduct(buildCreatePayload(sourceProduct, config));
      count(report, 'created');
      recordOperation(report, {
        status: 'created',
        identity,
        dryRun: false,
        shopifyProductId: createdProduct.id,
        title: sourceProduct.title,
      });
      if (!shopifyProducts.some((existingProduct) => existingProduct.id === createdProduct.id)) {
        shopifyProducts.push(createdProduct);
      }
      index = buildShopifyIndex(shopifyProducts);
      match = resolveShopifyMatch(sourceProduct, index);
      if (match.type !== 'matched') {
        count(report, 'failed');
        recordOperation(report, {
          status: 'failed',
          identity,
          reason: 'Created Shopify product could not be re-matched for follow-up operations',
        });
        continue;
      }
    }

    if (config.scope.has('catalog') && match.type === 'matched') {
      const changes = planCatalogUpdate(sourceProduct, match.product, match.variant, config);
      if (hasCatalogChanges(changes)) {
        if (config.dryRun) {
          count(report, 'updated');
          recordOperation(report, {
            status: 'updated',
            identity,
            dryRun: true,
            fields: [...Object.keys(changes.product), ...Object.keys(changes.variant)].sort(),
          });
        } else {
          if (Object.keys(changes.product).length) {
            await shopifyClient.updateProduct(match.product.id, changes.product);
          }
          if (Object.keys(changes.variant).length) {
            await shopifyClient.updateVariant(match.variant.id, changes.variant);
          }
          count(report, 'updated');
          recordOperation(report, {
            status: 'updated',
            identity,
            dryRun: false,
            fields: [...Object.keys(changes.product), ...Object.keys(changes.variant)].sort(),
          });
        }
      } else if (!config.scope.has('price') && !config.scope.has('inventory')) {
        summarizeSkippedReason(report, 'Already in sync', identity);
      }
    }

    if (config.scope.has('price') && match.type === 'matched') {
      const desiredPrice = formatPrice(sourceProduct.price);
      const desiredCompareAt = formatPrice(sourceProduct.compareAtPrice);
      const currentPrice = formatPrice(toNullableNumber(match.variant.price));
      const currentCompareAt = formatPrice(toNullableNumber(match.variant.compare_at_price));
      if (desiredPrice !== undefined && (currentPrice !== desiredPrice || currentCompareAt !== desiredCompareAt)) {
        if (config.dryRun) {
          count(report, 'updated');
          recordOperation(report, { status: 'updated', identity: `${identity}:price`, dryRun: true });
        } else {
          await shopifyClient.updateVariant(match.variant.id, {
            price: desiredPrice,
            compare_at_price: desiredCompareAt,
          });
          count(report, 'updated');
          recordOperation(report, { status: 'updated', identity: `${identity}:price`, dryRun: false });
        }
      } else {
        summarizeSkippedReason(report, 'Price already in sync', `${identity}:price`);
      }
    }

    if (config.scope.has('inventory') && match.type === 'matched') {
      if (sourceProduct.inventoryQuantity === null) {
        summarizeSkippedReason(report, 'Sellvia inventory quantity missing', `${identity}:inventory`);
      } else if (!locationId) {
        count(report, 'failed');
        recordOperation(report, { status: 'failed', identity: `${identity}:inventory`, reason: 'No Shopify location id available' });
      } else if (toNullableInteger(match.variant.inventory_quantity) === sourceProduct.inventoryQuantity) {
        summarizeSkippedReason(report, 'Inventory already in sync', `${identity}:inventory`);
      } else if (config.dryRun) {
        count(report, 'updated');
        recordOperation(report, { status: 'updated', identity: `${identity}:inventory`, dryRun: true });
      } else {
        await shopifyClient.setInventoryLevel(match.variant.inventory_item_id, locationId, sourceProduct.inventoryQuantity);
        count(report, 'updated');
        recordOperation(report, { status: 'updated', identity: `${identity}:inventory`, dryRun: false });
      }
    }
  }

  if (config.scope.has('orders')) {
    if (!config.enableOrderSync) {
      report.warnings.push('Order synchronization is disabled by default and remains unsupported until explicit API coverage is configured.');
      summarizeSkippedReason(report, 'Order synchronization disabled', 'orders');
    } else if (!config.sellviaOrderEndpoint) {
      report.warnings.push('Order synchronization requested but SELLVIA_ORDER_ENDPOINT is not configured.');
      summarizeSkippedReason(report, 'SELLVIA_ORDER_ENDPOINT missing', 'orders');
    } else {
      report.warnings.push('Order synchronization endpoint configured, but write-side order automation remains intentionally disabled pending repository-native order contracts.');
      summarizeSkippedReason(report, 'Order synchronization intentionally blocked', 'orders');
    }
  }

  report.finishedAt = new Date().toISOString();
  report.status = report.blockers.length || report.counts.failed ? 'failed' : 'success';
  report.exitCode = report.status === 'success' ? 0 : 1;
  return report;
}

export function renderSummaryMarkdown(report) {
  const lines = [
    '# Shopify + Sellvia Sync',
    '',
    `- Status: **${report.status.toUpperCase()}**`,
    `- Scope: ${report.scope.join(', ')}`,
    `- Mode: ${report.effectiveDryRun ? 'dry-run' : 'write'}`,
    `- Protection: ${report.protection}`,
    '',
    '| Metric | Count |',
    '| --- | ---: |',
    `| Sellvia fetched | ${report.counts.fetched.sellviaProducts} |`,
    `| Shopify fetched | ${report.counts.fetched.shopifyProducts} |`,
    `| Created | ${report.counts.created} |`,
    `| Updated | ${report.counts.updated} |`,
    `| Skipped | ${report.counts.skipped} |`,
    `| Failed | ${report.counts.failed} |`,
  ];

  if (report.blockers.length) {
    lines.push('', '## Blocking configuration issues', '');
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  }

  if (report.warnings.length) {
    lines.push('', '## Warnings', '');
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }

  if (report.operations.length) {
    lines.push('', '## Operation sample', '');
    for (const operation of report.operations.slice(0, 20)) {
      lines.push(`- ${operation.status}: ${operation.identity}${operation.reason ? ` — ${operation.reason}` : ''}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export async function writeReportFiles(report, options = {}) {
  const reportDir = options.reportDir || path.join(process.cwd(), '.sync-reports');
  await fs.mkdir(reportDir, { recursive: true });

  const reportPath = options.reportPath || path.join(reportDir, 'latest-report.json');
  const summaryPath = options.summaryPath || path.join(reportDir, 'latest-summary.md');
  const historyPath = options.historyPath || path.join(reportDir, 'history.jsonl');

  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(reportPath, serializedReport, 'utf8');
  await fs.writeFile(summaryPath, renderSummaryMarkdown(report), 'utf8');
  await fs.appendFile(historyPath, `${JSON.stringify(report)}\n`, 'utf8');

  return { reportPath, summaryPath, historyPath };
}
