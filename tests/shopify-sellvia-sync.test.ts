import { describe, expect, it, vi } from 'vitest';
import {
  buildShopifyIndex,
  normalizeSellviaProduct,
  parseScope,
  resolveShopifyMatch,
  runSync,
} from '../src/shopify-sellvia-sync/core.js';
import { requestWithRetry } from '../src/shopify-sellvia-sync/http.js';

describe('shopify-sellvia sync helpers', () => {
  it('normalizes a Sellvia product into deterministic fields', () => {
    const product = normalizeSellviaProduct({
      external_id: 'sv-100',
      sku: 'GEM-001',
      name: 'Gem Necklace',
      sale_price: '19.5',
      inventory: '8',
      tags: ['featured'],
    });

    expect(product.externalId).toBe('sv-100');
    expect(product.sku).toBe('GEM-001');
    expect(product.title).toBe('Gem Necklace');
    expect(product.price).toBe(19.5);
    expect(product.inventoryQuantity).toBe(8);
    expect(product.handle).toContain('gem-necklace');
  });

  it('detects ambiguous Shopify identity conflicts', () => {
    const index = buildShopifyIndex([
      {
        id: 1,
        title: 'A',
        tags: 'sellvia:id:sv-1',
        variants: [{ id: 11, sku: 'SKU-1' }],
      },
      {
        id: 2,
        title: 'B',
        tags: 'sellvia:id:sv-1',
        variants: [{ id: 22, sku: 'SKU-2' }],
      },
    ]);

    const match = resolveShopifyMatch(
      normalizeSellviaProduct({ external_id: 'sv-1', sku: 'SKU-1', name: 'Ring', price: 12 }),
      index,
    );

    expect(match.type).toBe('conflict');
  });

  it('retries transient 429 responses with retry-after backoff', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '0.01' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const response = await requestWithRetry('https://example.test/items', {}, { fetchImpl, sleepImpl, maxAttempts: 2 });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry an explicitly aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    await expect(
      requestWithRetry('https://example.test/items', { signal: controller.signal }, { fetchImpl, sleepImpl, maxAttempts: 3 }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });
});

describe('runSync', () => {
  const baseConfig = {
    requestedDryRun: true,
    dryRun: true,
    writeApproved: false,
    publishProducts: false,
    enableOrderSync: false,
    scope: parseScope('catalog,inventory,price'),
    shopifyStoreDomain: 'example.myshopify.com',
    shopifyAccessToken: 'token',
    shopifyLocationId: '99',
    sellviaBaseUrl: 'https://api.sellvia.test',
    sellviaAccessToken: 'sv-token',
    sellviaCatalogEndpoint: '/catalog',
    sellviaOrderEndpoint: '',
    catalogFixturePath: '',
    pageSize: 100,
    requestRuntime: {},
  };

  it('records planned creates in dry-run mode without writing', async () => {
    const shopifyClient = {
      listProducts: vi.fn().mockResolvedValue([]),
      getPrimaryLocationId: vi.fn().mockResolvedValue('99'),
      createProduct: vi.fn(),
      updateProduct: vi.fn(),
      updateVariant: vi.fn(),
      setInventoryLevel: vi.fn(),
    };
    const sellviaClient = {
      listCatalogProducts: vi.fn().mockResolvedValue([
        { external_id: 'sv-10', sku: 'SKU-10', name: 'Bracelet', sale_price: '29.99', inventory: 5 },
      ]),
    };

    const report: any = await runSync({ config: baseConfig, shopifyClient, sellviaClient });

    expect(report.status).toBe('success');
    expect(report.counts.created).toBe(1);
    expect(report.operations.some((entry: any) => entry.dryRun)).toBe(true);
    expect(shopifyClient.createProduct).not.toHaveBeenCalled();
    expect(shopifyClient.updateProduct).not.toHaveBeenCalled();
  });

  it('is idempotent across repeated write runs after initial create', async () => {
    const products: any[] = [];
    const shopifyClient = {
      listProducts: vi.fn().mockImplementation(async () => products),
      getPrimaryLocationId: vi.fn().mockResolvedValue('99'),
      createProduct: vi.fn().mockImplementation(async (product) => {
        const created = {
          id: 100,
          title: product.title,
          body_html: product.body_html,
          vendor: product.vendor,
          product_type: product.product_type,
          handle: product.handle,
          status: product.status,
          tags: product.tags,
          variants: [
            {
              id: 200,
              sku: product.variants[0].sku,
              price: product.variants[0].price,
              compare_at_price: product.variants[0].compare_at_price,
              inventory_item_id: 300,
              inventory_quantity: 0,
            },
          ],
        };
        products.splice(0, products.length, created);
        return created;
      }),
      updateProduct: vi.fn(),
      updateVariant: vi.fn(),
      setInventoryLevel: vi.fn().mockImplementation(async (_inventoryItemId, _locationId, available) => {
        products[0].variants[0].inventory_quantity = available;
      }),
    };
    const sellviaClient = {
      listCatalogProducts: vi.fn().mockResolvedValue([
        { external_id: 'sv-20', sku: 'SKU-20', name: 'Pendant', sale_price: '15.00', inventory: 3 },
      ]),
    };

    const writeConfig = { ...baseConfig, requestedDryRun: false, dryRun: false, writeApproved: true };
    const firstReport: any = await runSync({ config: writeConfig, shopifyClient, sellviaClient });
    const secondReport: any = await runSync({ config: writeConfig, shopifyClient, sellviaClient });

    expect(firstReport.counts.created).toBe(1);
    expect(shopifyClient.createProduct).toHaveBeenCalledTimes(1);
    expect(secondReport.counts.created).toBe(0);
    expect(secondReport.counts.updated).toBe(0);
    expect(secondReport.counts.skipped).toBeGreaterThan(0);
    expect(secondReport.counts.failed).toBe(0);
  });

  it('does not emit false catalog updates when Shopify tags are reordered or duplicated', async () => {
    const shopifyClient = {
      listProducts: vi.fn().mockResolvedValue([
        {
          id: 101,
          title: 'Pendant',
          body_html: '',
          vendor: 'Sellvia',
          product_type: '',
          handle: 'pendant-sv-20',
          status: 'draft',
          tags: 'extra, sellvia:managed, sellvia:id:sv-20, extra, sellvia:source:catalog',
          variants: [
            {
              id: 201,
              sku: 'SKU-20',
              price: '15.00',
              compare_at_price: undefined,
              inventory_item_id: 301,
              inventory_quantity: 3,
            },
          ],
        },
      ]),
      getPrimaryLocationId: vi.fn().mockResolvedValue('99'),
      createProduct: vi.fn(),
      updateProduct: vi.fn(),
      updateVariant: vi.fn(),
      setInventoryLevel: vi.fn(),
    };
    const sellviaClient = {
      listCatalogProducts: vi.fn().mockResolvedValue([
        { external_id: 'sv-20', sku: 'SKU-20', name: 'Pendant', sale_price: '15.00', inventory: 3, tags: ['extra'] },
      ]),
    };

    const report: any = await runSync({
      config: { ...baseConfig, scope: parseScope('catalog,inventory,price') },
      shopifyClient,
      sellviaClient,
    });

    expect(report.counts.updated).toBe(0);
    expect(report.counts.failed).toBe(0);
    expect(shopifyClient.updateProduct).not.toHaveBeenCalled();
    expect(shopifyClient.updateVariant).not.toHaveBeenCalled();
  });

  it('fails closed when configuration or required mapping inputs are missing', async () => {
    const report: any = await runSync({
      config: {
        ...baseConfig,
        sellviaCatalogEndpoint: '',
        catalogFixturePath: '',
      },
      shopifyClient: {} as any,
      sellviaClient: {} as any,
    });

    expect(report.status).toBe('failed');
    expect(report.blockers).toContain('Missing SELLVIA_CATALOG_ENDPOINT (or SELLVIA_CATALOG_FIXTURE_PATH for local validation)');
  });

  it('fails closed for order-only runs without explicit order support', async () => {
    const report: any = await runSync({
      config: {
        ...baseConfig,
        scope: parseScope('orders'),
        sellviaCatalogEndpoint: '',
      },
      shopifyClient: {} as any,
      sellviaClient: {} as any,
    });

    expect(report.status).toBe('failed');
    expect(report.blockers).toContain(
      'Order-only runs are blocked until SHOPIFY_SELLVIA_ENABLE_ORDER_SYNC=true and SELLVIA_ORDER_ENDPOINT are both configured.',
    );
  });
});
