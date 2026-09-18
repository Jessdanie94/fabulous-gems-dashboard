import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_SELLVIA_BASE_URL = "https://api.sellvia.com";
const DEFAULT_SHOPIFY_API_VERSION = "2025-01";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 1000;
const BULK_MUTATION_APPROVAL_THRESHOLD = 25;
const DEFAULT_ARTIFACT_DIR = path.resolve("artifacts/shopify-sellvia-sync");
const VALID_SCOPES = ["catalog", "inventory", "price", "orders"];

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) continue;

    const [rawKey, inlineValue] = part.slice(2).split("=", 2);
    const nextValue = inlineValue ?? argv[index + 1];
    const needsValue = inlineValue === undefined && nextValue && !nextValue.startsWith("--");
    const value = inlineValue ?? (needsValue ? nextValue : "true");

    if (needsValue) {
      index += 1;
    }

    parsed[rawKey] = value;
  }

  return parsed;
}

export async function loadEnvFile(envPath = path.resolve(".env")) {
  try {
    const raw = await fs.readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function envBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function envNumber(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function getRequiredEnv(names) {
  const value = firstDefined(...names.map((name) => process.env[name]));
  if (!value) {
    throw new Error(`Missing required configuration: ${names.join(" or ")}`);
  }
  return value;
}

function parseScopes(rawScope) {
  if (!rawScope || rawScope === "all") return [...VALID_SCOPES];
  const scopes = rawScope
    .split(",")
    .map((scope) => scope.trim().toLowerCase())
    .filter(Boolean);

  const invalid = scopes.filter((scope) => !VALID_SCOPES.includes(scope));
  if (invalid.length > 0) {
    throw new Error(`Unsupported scope values: ${invalid.join(", ")}`);
  }

  return [...new Set(scopes)];
}

export function buildConfig(options = {}) {
  const dryRun = envBoolean(firstDefined(options.dryRun, process.env.SYNC_DRY_RUN), true);
  const scopes = parseScopes(firstDefined(options.scope, process.env.SYNC_SCOPE, "catalog,inventory,price"));
  const writesEnabled = envBoolean(process.env.SYNC_ENABLE_WRITES, false) && !dryRun;

  return {
    dryRun,
    scopes,
    writesEnabled,
    priceWritesEnabled: writesEnabled && envBoolean(process.env.SYNC_ENABLE_PRICE_WRITES, false),
    inventoryWritesEnabled: writesEnabled && envBoolean(process.env.SYNC_ENABLE_INVENTORY_WRITES, false),
    orderWritesEnabled: writesEnabled && envBoolean(process.env.SYNC_ENABLE_ORDER_WRITES, false),
    approveBulkChanges: envBoolean(process.env.SYNC_APPROVE_BULK_CHANGES, false),
    shopify: {
      storeDomain: getRequiredEnv(["SHOPIFY_STORE_DOMAIN"]),
      accessToken: getRequiredEnv(["SHOPIFY_ADMIN_ACCESS_TOKEN", "SHOPIFY_API_TOKEN"]),
      apiVersion: process.env.SHOPIFY_API_VERSION || DEFAULT_SHOPIFY_API_VERSION,
      locationId: firstDefined(process.env.SHOPIFY_LOCATION_ID),
      productsFile: firstDefined(process.env.SHOPIFY_PRODUCTS_FILE),
      ordersFile: firstDefined(process.env.SHOPIFY_ORDERS_FILE),
    },
    sellvia: {
      accessKey: getRequiredEnv(["SELLVIA_API_KEY", "SELLVIA_MASTER_KEY"]),
      baseUrl: (process.env.SELLVIA_API_BASE_URL || DEFAULT_SELLVIA_BASE_URL).replace(/\/$/, ""),
      productsUrl: firstDefined(process.env.SELLVIA_PRODUCTS_URL),
      productsFile: firstDefined(process.env.SELLVIA_PRODUCTS_FILE),
      inventoryUrl: firstDefined(process.env.SELLVIA_INVENTORY_URL),
      inventoryFile: firstDefined(process.env.SELLVIA_INVENTORY_FILE),
      pricesUrl: firstDefined(process.env.SELLVIA_PRICES_URL),
      pricesFile: firstDefined(process.env.SELLVIA_PRICES_FILE),
      ordersUrl: firstDefined(process.env.SELLVIA_ORDERS_URL),
      ordersFile: firstDefined(process.env.SELLVIA_ORDERS_FILE),
    },
    artifactsDir: path.resolve(process.env.SYNC_ARTIFACTS_DIR || DEFAULT_ARTIFACT_DIR),
    timeoutMs: envNumber(process.env.SYNC_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxRetries: envNumber(process.env.SYNC_MAX_RETRIES, DEFAULT_MAX_RETRIES),
    backoffMs: envNumber(process.env.SYNC_BACKOFF_MS, DEFAULT_BACKOFF_MS),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAbortSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function nextBackoffDelay(baseDelay, attempt) {
  return Math.min(baseDelay * 2 ** (attempt - 1), 8000);
}

function isTransientError(error) {
  return Boolean(
    error?.name === "AbortError" ||
      error?.code === "ECONNRESET" ||
      error?.code === "ETIMEDOUT" ||
      error?.retryable === true,
  );
}

export async function requestWithRetry(url, init = {}, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  let rateLimited = 0;
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    attempts = attempt + 1;
    const { signal, cleanup } = createAbortSignal(timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal });
      cleanup();

      if (response.status === 429) {
        rateLimited += 1;
      }

      if (!response.ok && isRetryableStatus(response.status) && attempt < maxRetries) {
        const error = new Error(`Transient HTTP ${response.status} from ${url}`);
        error.retryable = true;
        error.status = response.status;
        await sleep(nextBackoffDelay(backoffMs, attempt + 1));
        continue;
      }

      return { response, attempts, rateLimited };
    } catch (error) {
      cleanup();
      if (attempt >= maxRetries || !isTransientError(error)) {
        error.attempts = attempts;
        error.rateLimited = rateLimited;
        throw error;
      }
      await sleep(nextBackoffDelay(backoffMs, attempt + 1));
    }
  }

  throw new Error(`Failed request to ${url} after ${attempts} attempts`);
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(path.resolve(filePath), "utf8");
  return JSON.parse(raw);
}

function extractArrayPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.orders)) return payload.orders;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data?.products)) return payload.data.products;
  if (Array.isArray(payload?.data?.orders)) return payload.data.orders;
  return [];
}

function extractNextCursor(payload) {
  return firstDefined(
    payload?.next,
    payload?.nextCursor,
    payload?.next_cursor,
    payload?.pagination?.next,
    payload?.pagination?.nextCursor,
    payload?.pagination?.next_cursor,
    payload?.pageInfo?.next,
    payload?.pageInfo?.endCursor,
  );
}

async function loadCollectionFromSource({ url, file, headers = {}, timeoutMs, maxRetries, backoffMs }) {
  if (file) {
    return extractArrayPayload(await readJsonFile(file));
  }

  if (!url) return [];

  const collected = [];
  let nextUrl = url;
  let pages = 0;

  while (nextUrl) {
    pages += 1;
    if (pages > 100) {
      throw new Error(`Pagination safety stop exceeded for ${url}`);
    }

    const { response } = await requestWithRetry(nextUrl, { headers }, { timeoutMs, maxRetries, backoffMs });
    const payload = await response.json();
    collected.push(...extractArrayPayload(payload));

    const nextCursor = extractNextCursor(payload);
    if (!nextCursor || nextCursor === nextUrl) {
      nextUrl = null;
      continue;
    }

    if (/^https?:\/\//.test(nextCursor)) {
      nextUrl = nextCursor;
      continue;
    }

    const currentUrl = new URL(nextUrl);
    currentUrl.searchParams.set("cursor", nextCursor);
    nextUrl = currentUrl.toString();
  }

  return collected;
}

function sanitizeString(value) {
  if (value === undefined || value === null) return undefined;
  const stringValue = String(value).trim();
  return stringValue || undefined;
}

function normalizeHandle(value) {
  const raw = sanitizeString(value);
  if (!raw) return undefined;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 255);
}

function normalizePrice(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`Invalid price value: ${value}`);
  }
  return numeric.toFixed(2);
}

function normalizeInventory(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new Error(`Invalid inventory value: ${value}`);
  }
  return numeric;
}

function normalizeSellviaReference(record) {
  const variant = Array.isArray(record?.variants) ? record.variants[0] : undefined;
  const sku = sanitizeString(record?.sku ?? variant?.sku);
  const externalId = sanitizeString(record?.externalId ?? record?.id ?? record?.productId);
  const title = sanitizeString(record?.title ?? record?.name ?? variant?.title);
  const handle = normalizeHandle(record?.handle ?? title ?? sku ?? externalId);

  if (!externalId && !sku && !handle) {
    throw new Error(`Sellvia record ${title || "unknown"} is missing all identity fields`);
  }

  return { variant, sku, externalId, title, handle };
}

function normalizeSellviaProduct(record) {
  const { variant, sku, externalId, title, handle } = normalizeSellviaReference(record);

  if (!title) {
    throw new Error("Sellvia record is missing a title/name");
  }

  return {
    externalId,
    sku,
    title,
    handle,
    vendor: sanitizeString(record?.vendor) || "Sellvia",
    price: normalizePrice(record?.price ?? record?.salePrice ?? variant?.price),
    inventory: normalizeInventory(record?.inventory ?? record?.stock ?? record?.quantity ?? variant?.inventory_quantity),
    tags: Array.isArray(record?.tags) ? record.tags.map(String) : [],
    raw: record,
  };
}

export function buildIdentityKey(record) {
  if (record.externalId) return `external:${record.externalId}`;
  if (record.sku) return `sku:${record.sku.toLowerCase()}`;
  if (record.handle) return `handle:${record.handle}`;
  throw new Error(`Unable to build identity key for ${record.title || "unknown product"}`);
}

function tagList(tags) {
  return String(tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function indexShopifyProducts(products = []) {
  const index = new Map();

  for (const product of products) {
    const record = {
      id: product.id,
      title: product.title,
      handle: product.handle,
      tags: tagList(product.tags),
      variants: Array.isArray(product.variants)
        ? product.variants.map((variant) => ({
            id: variant.id,
            sku: variant.sku,
            price: variant.price,
            inventory_quantity: variant.inventory_quantity,
            inventory_item_id: variant.inventory_item_id,
          }))
        : [],
    };

    for (const tag of record.tags) {
      if (tag.startsWith("sellvia-id:")) {
        index.set(`external:${tag.slice("sellvia-id:".length)}`, record);
      }
    }

    if (record.handle) {
      index.set(`handle:${record.handle}`, record);
    }

    for (const variant of record.variants) {
      if (variant?.sku) {
        index.set(`sku:${String(variant.sku).toLowerCase()}`, record);
      }
    }
  }

  return index;
}

export function planProductChanges(sellviaProducts, shopifyProducts) {
  const normalized = sellviaProducts.map(normalizeSellviaProduct);
  const index = indexShopifyProducts(shopifyProducts);
  const seenTargets = new Set();
  const plan = [];

  for (const product of normalized) {
    const identityKey = buildIdentityKey(product);
    const match = index.get(identityKey)
      || (product.sku ? index.get(`sku:${product.sku.toLowerCase()}`) : undefined)
      || (product.handle ? index.get(`handle:${product.handle}`) : undefined);

    if (!match) {
      plan.push({ action: "create", identityKey, source: product, target: null, updates: [] });
      continue;
    }

    if (seenTargets.has(match.id)) {
      throw new Error(`Ambiguous Shopify mapping detected for ${identityKey}`);
    }
    seenTargets.add(match.id);

    const variant = match.variants.find((candidate) => candidate?.sku && candidate.sku.toLowerCase() === product.sku?.toLowerCase())
      || match.variants[0];

    if (!variant && (product.price !== undefined || product.inventory !== undefined)) {
      throw new Error(`Matched Shopify product is missing a variant for ${identityKey}`);
    }

    const updates = [];
    if (product.title && product.title !== match.title) {
      updates.push({ field: "title", from: match.title, to: product.title, risk: "medium" });
    }
    if (product.handle && product.handle !== match.handle) {
      updates.push({ field: "handle", from: match.handle, to: product.handle, risk: "medium" });
    }
    if (product.price && variant?.price !== product.price) {
      updates.push({ field: "price", from: variant?.price, to: product.price, risk: "high" });
    }
    if (product.inventory !== undefined && variant?.inventory_quantity !== product.inventory) {
      updates.push({ field: "inventory", from: variant?.inventory_quantity, to: product.inventory, risk: "high" });
    }

    plan.push({
      action: updates.length > 0 ? "update" : "skip",
      identityKey,
      source: product,
      target: { ...match, variant },
      updates,
    });
  }

  return plan;
}

function parseLinkHeader(linkHeader) {
  if (!linkHeader) return null;
  for (const section of linkHeader.split(",")) {
    if (section.includes('rel="next"')) {
      const match = section.match(/<([^>]+)>/);
      return match?.[1] || null;
    }
  }
  return null;
}

async function fetchAllShopifyProducts(config, counters) {
  if (config.shopify.productsFile) {
    return extractArrayPayload(await readJsonFile(config.shopify.productsFile));
  }

  const headers = {
    "X-Shopify-Access-Token": config.shopify.accessToken,
    "Content-Type": "application/json",
  };
  const products = [];
  let nextUrl = `https://${config.shopify.storeDomain}/admin/api/${config.shopify.apiVersion}/products.json?limit=250`;
  let pages = 0;

  while (nextUrl) {
    pages += 1;
    if (pages > 100) {
      throw new Error("Shopify pagination safety stop exceeded");
    }

    const { response, rateLimited } = await requestWithRetry(nextUrl, { headers }, config);
    counters.rateLimited += rateLimited;
    const payload = await response.json();
    products.push(...(payload.products || []));
    nextUrl = parseLinkHeader(response.headers.get("link"));
  }

  return products;
}

async function applyCreate(config, action, counters) {
  const payload = {
    product: {
      title: action.source.title,
      handle: action.source.handle,
      vendor: action.source.vendor,
      tags: [...action.source.tags, ...(action.source.externalId ? [`sellvia-id:${action.source.externalId}`] : [])].join(", "),
      variants: [
        {
          sku: action.source.sku,
          price: action.source.price,
          inventory_management: action.source.inventory !== undefined ? "shopify" : undefined,
        },
      ],
    },
  };

  if (config.dryRun) {
    counters.created += 1;
    return { simulated: true, payload };
  }

  const url = `https://${config.shopify.storeDomain}/admin/api/${config.shopify.apiVersion}/products.json`;
  const { response, rateLimited } = await requestWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": config.shopify.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    config,
  );
  counters.rateLimited += rateLimited;
  if (!response.ok) {
    throw new Error(`Failed to create Shopify product for ${action.identityKey}`);
  }
  counters.created += 1;
  return response.json();
}

async function applyUpdate(config, action, counters, warnings) {
  const allowedUpdates = action.updates.filter((update) => {
    if (update.field === "price" && !config.priceWritesEnabled) {
      warnings.push(`Skipped price mutation for ${action.identityKey} because SYNC_ENABLE_PRICE_WRITES is false.`);
      return false;
    }

    if (update.field === "inventory") {
      if (!config.inventoryWritesEnabled) {
        warnings.push(`Skipped inventory mutation for ${action.identityKey} because SYNC_ENABLE_INVENTORY_WRITES is false.`);
        return false;
      }
      if (!config.shopify.locationId) {
        warnings.push(`Skipped inventory mutation for ${action.identityKey} because SHOPIFY_LOCATION_ID is not configured.`);
        return false;
      }
      if (!action.target.variant?.inventory_item_id) {
        throw new Error(`Matched Shopify variant is missing inventory_item_id for ${action.identityKey}`);
      }
    }

    if ((update.field === "price" || update.field === "inventory") && !action.target.variant) {
      throw new Error(`Matched Shopify product is missing a variant for ${action.identityKey}`);
    }

    return true;
  });

  if (allowedUpdates.length === 0) {
    counters.skipped += 1;
    return { skipped: true };
  }

  if (config.dryRun) {
    counters.updated += 1;
    return { simulated: true, updates: allowedUpdates };
  }

  const nonInventoryUpdates = allowedUpdates.filter((update) => update.field !== "inventory");
  const inventoryUpdate = allowedUpdates.find((update) => update.field === "inventory");

  if (!config.writesEnabled) {
    throw new Error(`Pending mutations require SYNC_ENABLE_WRITES=true (${action.identityKey})`);
  }

  if (nonInventoryUpdates.length > 0) {
    const payload = {
      product: {
        id: action.target.id,
        title: nonInventoryUpdates.find((update) => update.field === "title")?.to || action.target.title,
        handle: nonInventoryUpdates.find((update) => update.field === "handle")?.to || action.target.handle,
        variants: [
          {
            id: action.target.variant?.id,
            price: nonInventoryUpdates.find((update) => update.field === "price")?.to || action.target.variant?.price,
          },
        ],
      },
    };

    const { response, rateLimited } = await requestWithRetry(
      `https://${config.shopify.storeDomain}/admin/api/${config.shopify.apiVersion}/products/${action.target.id}.json`,
      {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": config.shopify.accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      config,
    );
    counters.rateLimited += rateLimited;
    if (!response.ok) {
      throw new Error(`Failed to update Shopify product ${action.target.id}`);
    }
  }

  if (inventoryUpdate) {
    const { response, rateLimited } = await requestWithRetry(
      `https://${config.shopify.storeDomain}/admin/api/${config.shopify.apiVersion}/inventory_levels/set.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": config.shopify.accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          location_id: Number(config.shopify.locationId),
          inventory_item_id: action.target.variant?.inventory_item_id,
          available: inventoryUpdate.to,
        }),
      },
      config,
    );
    counters.rateLimited += rateLimited;
    if (!response.ok) {
      throw new Error(`Failed to update inventory for Shopify product ${action.target.id}`);
    }
  }

  counters.updated += 1;
  return { updated: true };
}

function enforceMutationSafety(config, plan) {
  const actionableMutations = plan.filter((action) => action.action !== "skip");
  const riskyMutations = actionableMutations.filter((action) =>
    action.updates.some((update) => update.risk === "high"),
  );
  const totalMutations = actionableMutations.length;

  if (!config.dryRun && totalMutations > 0 && !config.writesEnabled) {
    throw new Error("Pending mutations detected while SYNC_ENABLE_WRITES is disabled.");
  }

  if (!config.dryRun && totalMutations > BULK_MUTATION_APPROVAL_THRESHOLD && !config.approveBulkChanges) {
    throw new Error(
      `Refusing ${totalMutations} pending mutations without SYNC_APPROVE_BULK_CHANGES=true`,
    );
  }

  if (!config.dryRun && riskyMutations.length > 0 && !config.approveBulkChanges) {
    throw new Error(
      `Refusing ${riskyMutations.length} high-risk mutations without SYNC_APPROVE_BULK_CHANGES=true`,
    );
  }
}

async function loadSellviaDatasets(config, counters) {
  const headers = {
    Authorization: ["Bearer", config.sellvia.accessKey].join(" "),
      "Content-Type": "application/json",
  };

  const datasets = {
    catalog: [],
    inventory: [],
    price: [],
    orders: [],
  };

  if (config.scopes.includes("catalog")) {
    if (!config.sellvia.productsUrl && !config.sellvia.productsFile) {
      throw new Error("Missing SELLVIA_PRODUCTS_URL or SELLVIA_PRODUCTS_FILE for catalog sync");
    }
    datasets.catalog = await loadCollectionFromSource({
      url: config.sellvia.productsUrl,
      file: config.sellvia.productsFile,
      headers,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      backoffMs: config.backoffMs,
    });
  }

  if (config.scopes.includes("inventory")) {
    if (!config.sellvia.inventoryUrl && !config.sellvia.inventoryFile) {
      throw new Error("Missing SELLVIA_INVENTORY_URL or SELLVIA_INVENTORY_FILE for inventory sync");
    }
    datasets.inventory = await loadCollectionFromSource({
      url: config.sellvia.inventoryUrl,
      file: config.sellvia.inventoryFile,
      headers,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      backoffMs: config.backoffMs,
    });
  }

  if (config.scopes.includes("price")) {
    if (!config.sellvia.pricesUrl && !config.sellvia.pricesFile) {
      throw new Error("Missing SELLVIA_PRICES_URL or SELLVIA_PRICES_FILE for price sync");
    }
    datasets.price = await loadCollectionFromSource({
      url: config.sellvia.pricesUrl,
      file: config.sellvia.pricesFile,
      headers,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      backoffMs: config.backoffMs,
    });
  }

  if (config.scopes.includes("orders")) {
    if (!config.sellvia.ordersUrl && !config.sellvia.ordersFile) {
      throw new Error("Missing SELLVIA_ORDERS_URL or SELLVIA_ORDERS_FILE for order sync");
    }
    datasets.orders = await loadCollectionFromSource({
      url: config.sellvia.ordersUrl,
      file: config.sellvia.ordersFile,
      headers,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      backoffMs: config.backoffMs,
    });
  }

  counters.fetched += datasets.catalog.length + datasets.inventory.length + datasets.price.length + datasets.orders.length;
  return datasets;
}

function mergeDatasets(datasets) {
  const merged = new Map();

  for (const record of datasets.catalog) {
    const normalized = normalizeSellviaProduct(record);
    merged.set(buildIdentityKey(normalized), normalized.raw);
  }

  for (const [scope, records] of Object.entries({ inventory: datasets.inventory, price: datasets.price })) {
    for (const record of records) {
      const reference = normalizeSellviaReference(record);
      const key = buildIdentityKey(reference);
      const existing = merged.get(key) || {};
      const normalizedValue =
        scope === "inventory"
          ? normalizeInventory(record?.inventory ?? record?.stock ?? record?.quantity)
          : normalizePrice(record?.price ?? record?.salePrice);
      merged.set(
        key,
        {
          ...existing,
          ...record,
          ...(reference.externalId ? { externalId: reference.externalId } : {}),
          ...(reference.sku ? { sku: reference.sku } : {}),
          ...(reference.handle ? { handle: reference.handle } : {}),
          ...(scope === "inventory" ? { inventory: normalizedValue } : { price: normalizedValue }),
        },
      );
    }
  }

  return [...merged.values()];
}

function buildRunSummary(config, counters, warnings = [], errors = []) {
  return {
    dryRun: config.dryRun,
    scopes: config.scopes,
    fetched: counters.fetched,
    created: counters.created,
    updated: counters.updated,
    skipped: counters.skipped,
    failed: counters.failed,
    rateLimited: counters.rateLimited,
    warnings,
    errors,
  };
}

async function writeArtifacts(config, payload) {
  await fs.mkdir(config.artifactsDir, { recursive: true });
  await fs.writeFile(path.join(config.artifactsDir, "summary.json"), JSON.stringify(payload.summary, null, 2));
  await fs.writeFile(path.join(config.artifactsDir, "details.json"), JSON.stringify(payload.details, null, 2));
  const summaryLines = [
    `# Shopify + Sellvia Sync ${payload.summary.failed > 0 ? "Failure" : "Summary"}`,
    "",
    `- Dry run: ${payload.summary.dryRun}`,
    `- Scope: ${payload.summary.scopes.join(", ")}`,
    `- Fetched: ${payload.summary.fetched}`,
    `- Created: ${payload.summary.created}`,
    `- Updated: ${payload.summary.updated}`,
    `- Skipped: ${payload.summary.skipped}`,
    `- Failed: ${payload.summary.failed}`,
    `- Rate-limited: ${payload.summary.rateLimited}`,
  ];

  if (payload.summary.warnings.length > 0) {
    summaryLines.push("", "## Warnings", ...payload.summary.warnings.map((warning) => `- ${warning}`));
  }
  if (payload.summary.errors.length > 0) {
    summaryLines.push("", "## Errors", ...payload.summary.errors.map((error) => `- ${error}`));
  }

  await fs.writeFile(path.join(config.artifactsDir, "summary.md"), `${summaryLines.join("\n")}\n`);
}

export async function runSync(options = {}) {
  const config = buildConfig(options);
  const counters = {
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    rateLimited: 0,
  };
  const warnings = [];
  const errors = [];
  const startedAt = new Date().toISOString();

  try {
    const datasets = await loadSellviaDatasets(config, counters);
    const combinedProducts = mergeDatasets(datasets);
    const shopifyProducts = await fetchAllShopifyProducts(config, counters);
    counters.fetched += shopifyProducts.length;

    const plan = planProductChanges(combinedProducts, shopifyProducts);
    enforceMutationSafety(config, plan);

    for (const action of plan) {
      try {
        if (action.action === "skip") {
          counters.skipped += 1;
          continue;
        }
        if (action.action === "create") {
          await applyCreate(config, action, counters);
          continue;
        }
        await applyUpdate(config, action, counters, warnings);
      } catch (error) {
        counters.failed += 1;
        errors.push(`${action.identityKey}: ${error.message}`);
      }
    }

    if (config.scopes.includes("orders")) {
      warnings.push(
        config.orderWritesEnabled
          ? "Order write operations are intentionally disabled pending account-specific Sellvia order contract validation."
          : "Order sync remains read-only/disabled because account-specific order contract validation is not configured.",
      );
      counters.skipped += datasets.orders.length;
    }

    const summary = buildRunSummary(config, counters, warnings, errors);
    const details = {
      startedAt,
      completedAt: new Date().toISOString(),
      config: {
        dryRun: config.dryRun,
        scopes: config.scopes,
        writesEnabled: config.writesEnabled,
        priceWritesEnabled: config.priceWritesEnabled,
        inventoryWritesEnabled: config.inventoryWritesEnabled,
        orderWritesEnabled: config.orderWritesEnabled,
      },
      datasetSizes: {
        catalog: datasets.catalog.length,
        inventory: datasets.inventory.length,
        price: datasets.price.length,
        orders: datasets.orders.length,
        shopifyProducts: shopifyProducts.length,
      },
      actions: plan.map((action) => ({
        identityKey: action.identityKey,
        action: action.action,
        updates: action.updates,
        source: {
          externalId: action.source.externalId,
          sku: action.source.sku,
          title: action.source.title,
          handle: action.source.handle,
        },
        target: action.target
          ? {
              id: action.target.id,
              title: action.target.title,
              handle: action.target.handle,
              variantId: action.target.variant?.id,
              sku: action.target.variant?.sku,
            }
          : null,
      })),
      warnings,
      errors,
    };

    await writeArtifacts(config, { summary, details });

    if (errors.length > 0) {
      const error = new Error(`Sync completed with ${errors.length} failure(s)`);
      error.summary = summary;
      throw error;
    }

    return { summary, details, config };
  } catch (error) {
    const summary = buildRunSummary(config, { ...counters, failed: counters.failed + 1 }, warnings, [...errors, error.message]);
    const details = {
      startedAt,
      completedAt: new Date().toISOString(),
      fatal: true,
      error: error.message,
      warnings,
      errors: [...errors, error.message],
    };
    await writeArtifacts(config, { summary, details });
    error.summary = summary;
    throw error;
  }
}
