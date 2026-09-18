import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_SHOPIFY_API_VERSION = "2025-01";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 1000;
const DEFAULT_MATCH_WINDOW_DAYS = 3;
const DEFAULT_ARTIFACT_DIR = path.resolve("artifacts/reconciliation-sync");
const VALID_SOURCES = ["shopify-only", "shopify-sellvia"];

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const nextValue = inlineValue ?? argv[index + 1];
    const hasSeparateValue = inlineValue === undefined && nextValue && !nextValue.startsWith("--");
    const value = inlineValue ?? (hasSeparateValue ? nextValue : "true");

    if (hasSeparateValue) index += 1;
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
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
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

function normalizeDateInput(value) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date format "${value}"; expected YYYY-MM-DD`);
  }
  return value;
}

function getRequiredEnv(names) {
  const value = firstDefined(...names.map((name) => process.env[name]));
  if (!value) {
    throw new Error(`Missing required configuration: ${names.join(" or ")}`);
  }
  return value;
}

function parseSource(value) {
  if (!value) return "shopify-only";
  const normalized = String(value).toLowerCase();
  if (!VALID_SOURCES.includes(normalized)) {
    throw new Error(`Unsupported reconciliation source: ${value}`);
  }
  return normalized;
}

export function buildConfig(options = {}) {
  const source = parseSource(firstDefined(options.source, process.env.RECON_SOURCE, "shopify-only"));
  const startDate = normalizeDateInput(firstDefined(options.startDate, process.env.RECON_START_DATE));
  const endDate = normalizeDateInput(firstDefined(options.endDate, process.env.RECON_END_DATE));

  if (startDate && endDate && startDate > endDate) {
    throw new Error("RECON_START_DATE cannot be after RECON_END_DATE");
  }

  const config = {
    source,
    dryRun: envBoolean(firstDefined(options.dryRun, process.env.RECON_DRY_RUN), true),
    dateWindow: {
      startDate,
      endDate,
    },
    matchWindowDays: Math.max(
      1,
      envNumber(firstDefined(options.matchWindowDays, process.env.RECON_MATCH_WINDOW_DAYS), DEFAULT_MATCH_WINDOW_DAYS),
    ),
    timeoutMs: envNumber(process.env.RECON_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxRetries: Math.max(0, envNumber(process.env.RECON_MAX_RETRIES, DEFAULT_MAX_RETRIES)),
    backoffMs: Math.max(0, envNumber(process.env.RECON_BACKOFF_MS, DEFAULT_BACKOFF_MS)),
    artifactsDir: path.resolve(process.env.RECON_ARTIFACTS_DIR || DEFAULT_ARTIFACT_DIR),
    shopify: {
      storeDomain: getRequiredEnv(["SHOPIFY_STORE_DOMAIN"]),
      accessToken: getRequiredEnv(["SHOPIFY_ADMIN_ACCESS_TOKEN", "SHOPIFY_API_TOKEN"]),
      apiVersion: process.env.SHOPIFY_API_VERSION || DEFAULT_SHOPIFY_API_VERSION,
      payoutsFile: firstDefined(process.env.SHOPIFY_PAYOUTS_FILE),
      ordersFile: firstDefined(process.env.SHOPIFY_ORDERS_FILE),
      transactionsFile: firstDefined(process.env.SHOPIFY_TRANSACTIONS_FILE),
    },
    sellvia: {
      accessKey: firstDefined(process.env.SELLVIA_API_KEY, process.env.SELLVIA_MASTER_KEY),
      reconciliationUrl: firstDefined(process.env.SELLVIA_RECONCILIATION_URL),
      reconciliationFile: firstDefined(process.env.SELLVIA_RECONCILIATION_FILE),
    },
  };

  if (config.source === "shopify-sellvia") {
    if (!config.sellvia.reconciliationUrl && !config.sellvia.reconciliationFile) {
      throw new Error(
        "Missing SELLVIA_RECONCILIATION_URL or SELLVIA_RECONCILIATION_FILE for shopify-sellvia reconciliation",
      );
    }

    if (config.sellvia.reconciliationUrl && !config.sellvia.accessKey) {
      throw new Error(
        "Missing Sellvia API credentials. Set SELLVIA_API_KEY or SELLVIA_MASTER_KEY when using SELLVIA_RECONCILIATION_URL.",
      );
    }
  }

  return config;
}

function sanitizeString(value) {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  return str || undefined;
}

function parseMoney(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function normalizeCurrency(value) {
  const currency = sanitizeString(value);
  return currency ? currency.toUpperCase() : undefined;
}

function toIso(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return undefined;
  return date.toISOString();
}

function formatDateForApiBoundary(dateValue, endOfDay = false) {
  if (!dateValue) return undefined;
  const suffix = endOfDay ? "T23:59:59Z" : "T00:00:00Z";
  return `${dateValue}${suffix}`;
}

function parseLinkHeader(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    if (part.includes('rel="next"')) {
      const match = part.match(/<([^>]+)>/);
      return match?.[1] || null;
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAbortSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function nextBackoffDelay(baseDelay, attempt) {
  return Math.min(baseDelay * 2 ** (attempt - 1), 8000);
}

function parseRetryAfterDelay(retryAfterHeader, fallbackDelay) {
  if (!retryAfterHeader) return fallbackDelay;

  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryAt = Date.parse(retryAfterHeader);
  if (Number.isFinite(retryAt)) {
    return Math.max(retryAt - Date.now(), fallbackDelay);
  }

  return fallbackDelay;
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
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
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
        const retryError = new Error(`Transient HTTP ${response.status}`);
        retryError.retryable = true;
        const fallbackDelay = nextBackoffDelay(backoffMs, attempt + 1);
        const retryDelay =
          response.status === 429
            ? parseRetryAfterDelay(response.headers.get("retry-after"), fallbackDelay)
            : fallbackDelay;
        await sleep(retryDelay);
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
  if (Array.isArray(payload?.orders)) return payload.orders;
  if (Array.isArray(payload?.transactions)) return payload.transactions;
  if (Array.isArray(payload?.payouts)) return payload.payouts;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.orders)) return payload.data.orders;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  return [];
}

async function fetchShopifyOrders(config, counters) {
  if (config.shopify.ordersFile) {
    return extractArrayPayload(await readJsonFile(config.shopify.ordersFile));
  }

  const query = new URLSearchParams({
    status: "any",
    limit: "250",
    fields: [
      "id",
      "name",
      "order_number",
      "created_at",
      "processed_at",
      "currency",
      "current_total_price",
      "total_price",
      "total_refunds",
      "financial_status",
    ].join(","),
  });

  const createdMin = formatDateForApiBoundary(config.dateWindow.startDate, false);
  const createdMax = formatDateForApiBoundary(config.dateWindow.endDate, true);
  if (createdMin) query.set("created_at_min", createdMin);
  if (createdMax) query.set("created_at_max", createdMax);

  let nextUrl = `https://${config.shopify.storeDomain}/admin/api/${config.shopify.apiVersion}/orders.json?${query.toString()}`;
  const orders = [];
  let pages = 0;

  while (nextUrl) {
    pages += 1;
    if (pages > 100) throw new Error("Shopify orders pagination safety stop exceeded");

    const { response, rateLimited } = await requestWithRetry(
      nextUrl,
      {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": config.shopify.accessToken,
          "Content-Type": "application/json",
        },
      },
      config,
    );
    counters.rateLimited += rateLimited;

    if (!response.ok) {
      throw new Error(`Shopify orders request failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    orders.push(...(payload.orders || []));
    nextUrl = parseLinkHeader(response.headers.get("link"));
  }

  return orders;
}

async function fetchShopifyTransactions(config, orderIds, counters) {
  if (config.shopify.transactionsFile) {
    const payload = await readJsonFile(config.shopify.transactionsFile);

    if (Array.isArray(payload)) {
      return payload.reduce((accumulator, record) => {
        const orderId = sanitizeString(record?.orderId);
        if (!orderId) return accumulator;
        if (!accumulator[orderId]) accumulator[orderId] = [];
        accumulator[orderId].push(record);
        return accumulator;
      }, {});
    }

    if (payload && typeof payload === "object") {
      return payload;
    }

    return {};
  }

  const transactionsByOrder = {};

  for (const orderId of orderIds) {
    const { response, rateLimited } = await requestWithRetry(
      `https://${config.shopify.storeDomain}/admin/api/${config.shopify.apiVersion}/orders/${orderId}/transactions.json`,
      {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": config.shopify.accessToken,
          "Content-Type": "application/json",
        },
      },
      config,
    );
    counters.rateLimited += rateLimited;

    if (!response.ok) {
      throw new Error(`Shopify transactions request failed for order ${orderId}: ${response.status}`);
    }

    const payload = await response.json();
    transactionsByOrder[String(orderId)] = payload.transactions || [];
  }

  return transactionsByOrder;
}

async function fetchShopifyPayouts(config, counters) {
  if (config.shopify.payoutsFile) {
    return extractArrayPayload(await readJsonFile(config.shopify.payoutsFile));
  }

  const query = `
    {
      shopPaymentAccount {
        balance {
          amount
          currencyCode
        }
      }
      payouts(first: 50, reverse: true) {
        edges {
          node {
            id
            status
            amount {
              amount
              currencyCode
            }
            issuedAt
          }
        }
      }
    }
  `;

  const { response, rateLimited } = await requestWithRetry(
    `https://${config.shopify.storeDomain}/admin/api/${config.shopify.apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": config.shopify.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
    config,
  );
  counters.rateLimited += rateLimited;

  if (!response.ok) {
    throw new Error(`Shopify payouts query failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    throw new Error(`Shopify payouts contract unavailable: ${payload.errors[0].message}`);
  }

  if (!payload?.data?.payouts?.edges) {
    throw new Error("Shopify payouts contract unavailable: missing payouts data");
  }

  return payload.data.payouts.edges.map((edge) => ({
    id: edge.node.id,
    status: edge.node.status,
    amount: edge.node.amount?.amount,
    currency: edge.node.amount?.currencyCode,
    issuedAt: edge.node.issuedAt,
    balanceAmount: payload?.data?.shopPaymentAccount?.balance?.amount,
    balanceCurrency: payload?.data?.shopPaymentAccount?.balance?.currencyCode,
  }));
}

function choosePrimaryTransaction(transactions = []) {
  const successful = transactions.filter((entry) =>
    ["success", "pending"].includes(String(entry?.status || "").toLowerCase()),
  );

  if (successful.length === 0) return transactions[0];
  const prioritizedKinds = ["sale", "capture", "authorization"];

  for (const kind of prioritizedKinds) {
    const match = successful.find((entry) => String(entry?.kind || "").toLowerCase() === kind);
    if (match) return match;
  }

  return successful[0];
}

function providerReferenceFromTransaction(transaction) {
  return (
    sanitizeString(transaction?.authorization) ||
    sanitizeString(transaction?.receipt?.transaction_id) ||
    sanitizeString(transaction?.receipt?.payment_id) ||
    sanitizeString(transaction?.id)
  );
}

function redactValue(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, "[REDACTED_PHONE]");
}

function sanitizeError(error) {
  return redactValue(error instanceof Error ? error.message : String(error));
}

export function redactRecord(record = {}) {
  const disallowed = new Set([
    "customer",
    "email",
    "phone",
    "address",
    "billing_address",
    "shipping_address",
    "first_name",
    "last_name",
  ]);

  const safe = {};
  for (const [key, value] of Object.entries(record)) {
    if (disallowed.has(String(key).toLowerCase())) continue;
    safe[key] = typeof value === "string" ? redactValue(value) : value;
  }
  return safe;
}

function normalizeShopifyRecords(orders, transactionsByOrder) {
  return orders.map((order) => {
    const orderId = sanitizeString(order?.id);
    const transactions = Array.isArray(transactionsByOrder?.[String(orderId)])
      ? transactionsByOrder[String(orderId)]
      : [];
    const primaryTransaction = choosePrimaryTransaction(transactions);

    const amount = parseMoney(primaryTransaction?.amount ?? order?.current_total_price ?? order?.total_price);
    const currency = normalizeCurrency(primaryTransaction?.currency ?? order?.currency);
    const gross = parseMoney(order?.total_price);
    const refunds = parseMoney(order?.total_refunds);
    const fee = parseMoney(primaryTransaction?.fee ?? primaryTransaction?.receipt?.fee);
    const occurredAt =
      toIso(primaryTransaction?.processed_at) ||
      toIso(order?.processed_at) ||
      toIso(order?.created_at);

    return {
      orderId,
      orderName: sanitizeString(order?.name ?? order?.order_number),
      providerReference: providerReferenceFromTransaction(primaryTransaction),
      transactionId: sanitizeString(primaryTransaction?.id),
      amount,
      currency,
      occurredAt,
      gross,
      refunds,
      fees: fee,
      netFromOrder:
        gross !== undefined && refunds !== undefined && fee !== undefined
          ? gross - refunds - fee
          : undefined,
      financialStatus: sanitizeString(order?.financial_status),
    };
  });
}

function normalizeSellviaRecord(record) {
  return {
    sourceId: sanitizeString(record?.id ?? record?.externalId ?? record?.reference),
    orderId: sanitizeString(record?.shopifyOrderId ?? record?.orderId ?? record?.order_id),
    orderName: sanitizeString(record?.shopifyOrderName ?? record?.orderName ?? record?.order_name),
    providerReference: sanitizeString(
      record?.providerReference ?? record?.provider_reference ?? record?.transactionReference,
    ),
    amount: parseMoney(record?.amount ?? record?.net ?? record?.payoutAmount),
    currency: normalizeCurrency(record?.currency ?? record?.currencyCode),
    occurredAt: toIso(record?.processedAt ?? record?.createdAt ?? record?.date),
  };
}

async function loadSellviaRecords(config, counters) {
  if (config.source === "shopify-only") return [];

  let payload;
  if (config.sellvia.reconciliationFile) {
    payload = await readJsonFile(config.sellvia.reconciliationFile);
  } else {
    const { response, rateLimited } = await requestWithRetry(
      config.sellvia.reconciliationUrl,
      {
        method: "GET",
        headers: {
          Authorization: ["Bearer", config.sellvia.accessKey].join(" "),
          "Content-Type": "application/json",
        },
      },
      config,
    );
    counters.rateLimited += rateLimited;
    if (!response.ok) {
      throw new Error(`Sellvia reconciliation request failed: ${response.status} ${response.statusText}`);
    }
    payload = await response.json();
  }

  const records = extractArrayPayload(payload).map(normalizeSellviaRecord);
  if (records.length === 0) {
    throw new Error("Sellvia reconciliation contract unavailable: no readable order records found");
  }
  return records;
}

function normalizeReference(value) {
  const raw = sanitizeString(value);
  return raw ? raw.toLowerCase() : undefined;
}

function normalizeOrderIdentity(value) {
  const raw = sanitizeString(value);
  return raw ? raw.toLowerCase() : undefined;
}

function roundMoney(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : undefined;
}

function daysBetween(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const first = Date.parse(a);
  const second = Date.parse(b);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return Number.POSITIVE_INFINITY;
  return Math.abs(first - second) / (24 * 60 * 60 * 1000);
}

export function matchRecords(shopifyRecords, sellviaRecords, matchWindowDays = DEFAULT_MATCH_WINDOW_DAYS) {
  const matches = [];
  const unmatchedShopify = [...shopifyRecords.keys()];
  const unmatchedSellvia = [...sellviaRecords.keys()];

  const consume = (shopifyIndex, sellviaIndex, matchType, reviewNeeded) => {
    const unmatchedShopifyPos = unmatchedShopify.indexOf(shopifyIndex);
    if (unmatchedShopifyPos !== -1) unmatchedShopify.splice(unmatchedShopifyPos, 1);
    const unmatchedSellviaPos = unmatchedSellvia.indexOf(sellviaIndex);
    if (unmatchedSellviaPos !== -1) unmatchedSellvia.splice(unmatchedSellviaPos, 1);

    matches.push({
      matchType,
      reviewNeeded,
      shopify: shopifyRecords[shopifyIndex],
      sellvia: sellviaRecords[sellviaIndex],
    });
  };

  for (const shopifyIndex of [...unmatchedShopify]) {
    const shopify = shopifyRecords[shopifyIndex];
    const ref = normalizeReference(shopify.providerReference);
    if (!ref) continue;

    const candidates = unmatchedSellvia
      .map((index) => ({ index, record: sellviaRecords[index] }))
      .filter((candidate) => normalizeReference(candidate.record.providerReference) === ref)
      .sort((a, b) => daysBetween(shopify.occurredAt, a.record.occurredAt) - daysBetween(shopify.occurredAt, b.record.occurredAt));

    if (candidates.length > 0) {
      consume(shopifyIndex, candidates[0].index, "exact_provider_reference", false);
    }
  }

  for (const shopifyIndex of [...unmatchedShopify]) {
    const shopify = shopifyRecords[shopifyIndex];
    const identities = [normalizeOrderIdentity(shopify.orderId), normalizeOrderIdentity(shopify.orderName)].filter(Boolean);
    if (identities.length === 0) continue;

    const candidates = unmatchedSellvia
      .map((index) => ({ index, record: sellviaRecords[index] }))
      .filter((candidate) => {
        const sellviaIdentities = [
          normalizeOrderIdentity(candidate.record.orderId),
          normalizeOrderIdentity(candidate.record.orderName),
        ].filter(Boolean);
        return identities.some((identity) => sellviaIdentities.includes(identity));
      })
      .sort((a, b) => daysBetween(shopify.occurredAt, a.record.occurredAt) - daysBetween(shopify.occurredAt, b.record.occurredAt));

    if (candidates.length > 0) {
      consume(shopifyIndex, candidates[0].index, "stable_order_identifier", true);
    }
  }

  for (const shopifyIndex of [...unmatchedShopify]) {
    const shopify = shopifyRecords[shopifyIndex];
    if (shopify.amount === undefined || !shopify.currency || !shopify.occurredAt) continue;

    const targetAmount = roundMoney(shopify.amount);
    const candidates = unmatchedSellvia
      .map((index) => ({ index, record: sellviaRecords[index] }))
      .filter((candidate) => {
        if (candidate.record.amount === undefined || !candidate.record.currency || !candidate.record.occurredAt) return false;
        return (
          roundMoney(candidate.record.amount) === targetAmount &&
          candidate.record.currency === shopify.currency &&
          daysBetween(shopify.occurredAt, candidate.record.occurredAt) <= matchWindowDays
        );
      })
      .sort((a, b) => daysBetween(shopify.occurredAt, a.record.occurredAt) - daysBetween(shopify.occurredAt, b.record.occurredAt));

    if (candidates.length === 1) {
      consume(shopifyIndex, candidates[0].index, "amount_currency_date_window", true);
    }
  }

  return {
    matches,
    unmatchedShopify: unmatchedShopify.map((index) => shopifyRecords[index]),
    unmatchedSellvia: unmatchedSellvia.map((index) => sellviaRecords[index]),
  };
}

function summarizeAmount(values) {
  const usable = values.filter((entry) => entry.value !== undefined && entry.currency);
  if (usable.length === 0) {
    return { status: "unavailable", value: null, currency: null, reason: "No source values available" };
  }

  const currencies = [...new Set(usable.map((entry) => entry.currency))];
  if (currencies.length > 1) {
    return {
      status: "unavailable",
      value: null,
      currency: null,
      reason: `Multiple currencies present: ${currencies.join(", ")}`,
    };
  }

  const unavailableCount = values.length - usable.length;
  if (unavailableCount > 0) {
    return {
      status: "unavailable",
      value: null,
      currency: currencies[0],
      reason: `${unavailableCount} record(s) missing amount values`,
    };
  }

  return {
    status: "available",
    value: Number(usable.reduce((sum, entry) => sum + entry.value, 0).toFixed(2)),
    currency: currencies[0],
    reason: null,
  };
}

export function calculateTotals({ shopifyRecords, sellviaRecords, matches, payouts, source }) {
  const grossSales = summarizeAmount(
    shopifyRecords.map((record) => ({ value: record.gross, currency: record.currency })),
  );
  const refunds = summarizeAmount(
    shopifyRecords.map((record) => ({ value: record.refunds, currency: record.currency })),
  );
  const fees = summarizeAmount(
    shopifyRecords.map((record) => ({ value: record.fees, currency: record.currency })),
  );

  let netPayout;
  if (
    grossSales.status === "available" &&
    refunds.status === "available" &&
    fees.status === "available" &&
    grossSales.currency === refunds.currency &&
    refunds.currency === fees.currency
  ) {
    netPayout = {
      status: "available",
      value: Number((grossSales.value - refunds.value - fees.value).toFixed(2)),
      currency: grossSales.currency,
      reason: null,
    };
  } else {
    netPayout = {
      status: "unavailable",
      value: null,
      currency: grossSales.currency || refunds.currency || fees.currency || null,
      reason: "Net payout requires gross sales, refunds, and fees in a single currency",
    };
  }

  const expectedAmount =
    source === "shopify-sellvia"
      ? summarizeAmount(
          sellviaRecords.map((record) => ({ value: record.amount, currency: record.currency })),
        )
      : {
          status: "unavailable",
          value: null,
          currency: null,
          reason: "Shopify-only mode does not load Sellvia expected amounts",
        };

  const actualPayout = summarizeAmount(
    payouts.map((payout) => ({ value: parseMoney(payout.amount), currency: normalizeCurrency(payout.currency) })),
  );

  let variance;
  if (
    expectedAmount.status === "available" &&
    actualPayout.status === "available" &&
    expectedAmount.currency === actualPayout.currency
  ) {
    variance = {
      status: "available",
      value: Number((actualPayout.value - expectedAmount.value).toFixed(2)),
      currency: actualPayout.currency,
      reason: null,
    };
  } else {
    variance = {
      status: "unavailable",
      value: null,
      currency: actualPayout.currency || expectedAmount.currency || null,
      reason: "Variance requires expected and actual amounts in the same currency",
    };
  }

  return {
    grossSales,
    refunds,
    fees,
    netPayout,
    expectedAmount,
    actualPayout,
    variance,
    counts: {
      matched: matches.filter((match) => !match.reviewNeeded).length,
      reviewNeeded: matches.filter((match) => match.reviewNeeded).length,
      totalMatches: matches.length,
    },
  };
}

function toSafeMatch(match) {
  return {
    matchType: match.matchType,
    reviewNeeded: match.reviewNeeded,
    shopifyOrderId: match.shopify.orderId,
    shopifyOrderName: match.shopify.orderName,
    shopifyProviderReference: redactValue(match.shopify.providerReference),
    sellviaOrderId: match.sellvia.orderId,
    sellviaOrderName: match.sellvia.orderName,
    sellviaProviderReference: redactValue(match.sellvia.providerReference),
    amount: match.shopify.amount,
    currency: match.shopify.currency,
    occurredAt: match.shopify.occurredAt,
  };
}

function toSafeUnmatched(record, source) {
  return {
    source,
    orderId: record.orderId,
    orderName: record.orderName,
    providerReference: redactValue(record.providerReference),
    amount: record.amount,
    currency: record.currency,
    occurredAt: record.occurredAt,
  };
}

function markdownMetric(label, metric) {
  if (metric.status !== "available") {
    return `- ${label}: unavailable (${metric.reason})`;
  }
  return `- ${label}: ${metric.currency} ${metric.value.toFixed(2)}`;
}

async function writeArtifacts(config, summary, details) {
  await fs.mkdir(config.artifactsDir, { recursive: true });

  const matchRows = [
    "match_type,review_needed,shopify_order_id,shopify_order_name,sellvia_order_id,sellvia_order_name,amount,currency,occurred_at",
    ...details.matches.map((record) =>
      [
        record.matchType,
        record.reviewNeeded,
        record.shopifyOrderId,
        JSON.stringify(record.shopifyOrderName || ""),
        record.sellviaOrderId,
        JSON.stringify(record.sellviaOrderName || ""),
        record.amount ?? "",
        record.currency || "",
        record.occurredAt || "",
      ].join(","),
    ),
  ].join("\n");

  const summaryMd = [
    "# Payments Reconciliation Summary",
    "",
    `- Run mode: ${config.dryRun ? "dry-run" : "execution"}`,
    `- Source: ${config.source}`,
    `- Date window: ${summary.dateWindow.startDate || "open"} to ${summary.dateWindow.endDate || "open"}`,
    `- Matching window: ${config.matchWindowDays} day(s)`,
    `- Matched (exact): ${summary.matches.exact}`,
    `- Matched (review-needed): ${summary.matches.reviewNeeded}`,
    `- Unmatched Shopify records: ${summary.matches.unmatchedShopify}`,
    `- Unmatched Sellvia records: ${summary.matches.unmatchedSellvia}`,
    markdownMetric("Gross sales", summary.totals.grossSales),
    markdownMetric("Refunds", summary.totals.refunds),
    markdownMetric("Fees", summary.totals.fees),
    markdownMetric("Net payout", summary.totals.netPayout),
    markdownMetric("Expected amount", summary.totals.expectedAmount),
    markdownMetric("Actual payout", summary.totals.actualPayout),
    markdownMetric("Variance", summary.totals.variance),
    `- Errors: ${summary.errors.length}`,
  ];

  if (summary.errors.length > 0) {
    summaryMd.push("", "## Errors", ...summary.errors.map((error) => `- ${error}`));
  }

  await fs.writeFile(path.join(config.artifactsDir, "summary.json"), JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(config.artifactsDir, "details.json"), JSON.stringify(details, null, 2));
  await fs.writeFile(path.join(config.artifactsDir, "matches.csv"), `${matchRows}\n`);
  await fs.writeFile(path.join(config.artifactsDir, "summary.md"), `${summaryMd.join("\n")}\n`);

  const historyPath = path.join(config.artifactsDir, "history.json");
  let history = [];
  try {
    history = JSON.parse(await fs.readFile(historyPath, "utf8"));
    if (!Array.isArray(history)) history = [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  history.push({
    runAt: summary.completedAt,
    source: summary.source,
    dryRun: summary.dryRun,
    dateWindow: summary.dateWindow,
    matches: summary.matches,
    totals: {
      expectedAmount: summary.totals.expectedAmount,
      actualPayout: summary.totals.actualPayout,
      variance: summary.totals.variance,
    },
    errorCount: summary.errors.length,
  });

  await fs.writeFile(historyPath, JSON.stringify(history.slice(-90), null, 2));
}

function buildSummary(config, payload) {
  return {
    startedAt: payload.startedAt,
    completedAt: new Date().toISOString(),
    source: config.source,
    dryRun: config.dryRun,
    dateWindow: config.dateWindow,
    matchWindowDays: config.matchWindowDays,
    fetched: {
      shopifyOrders: payload.shopifyRecords.length,
      shopifyPayouts: payload.payouts.length,
      sellviaRecords: payload.sellviaRecords.length,
    },
    matches: {
      exact: payload.matches.filter((match) => !match.reviewNeeded).length,
      reviewNeeded: payload.matches.filter((match) => match.reviewNeeded).length,
      unmatchedShopify: payload.unmatchedShopify.length,
      unmatchedSellvia: payload.unmatchedSellvia.length,
    },
    totals: payload.totals,
    rateLimitedRequests: payload.rateLimitedRequests,
    errors: payload.errors,
  };
}

export async function runReconciliation(options = {}) {
  const config = buildConfig(options);
  const startedAt = new Date().toISOString();
  const counters = { rateLimited: 0 };
  const errors = [];

  try {
    const payouts = await fetchShopifyPayouts(config, counters);
    const orders = await fetchShopifyOrders(config, counters);
    const transactionsByOrder = await fetchShopifyTransactions(
      config,
      orders.map((order) => order.id),
      counters,
    );

    const shopifyRecords = normalizeShopifyRecords(orders, transactionsByOrder);
    const sellviaRecords = await loadSellviaRecords(config, counters);

    const { matches, unmatchedShopify, unmatchedSellvia } =
      config.source === "shopify-sellvia"
        ? matchRecords(shopifyRecords, sellviaRecords, config.matchWindowDays)
        : { matches: [], unmatchedShopify: shopifyRecords, unmatchedSellvia: [] };

    const totals = calculateTotals({
      shopifyRecords,
      sellviaRecords,
      matches,
      payouts,
      source: config.source,
    });

    const details = {
      startedAt,
      completedAt: new Date().toISOString(),
      source: config.source,
      dryRun: config.dryRun,
      dateWindow: config.dateWindow,
      matches: matches.map(toSafeMatch),
      unmatched: {
        shopify: unmatchedShopify.map((record) => toSafeUnmatched(redactRecord(record), "shopify")),
        sellvia: unmatchedSellvia.map((record) => toSafeUnmatched(redactRecord(record), "sellvia")),
      },
      payouts: payouts.map((payout) => ({
        id: payout.id,
        status: payout.status,
        amount: parseMoney(payout.amount),
        currency: normalizeCurrency(payout.currency),
        issuedAt: toIso(payout.issuedAt),
      })),
      totals,
      errors,
      adapterBoundary:
        config.source === "shopify-sellvia"
          ? "Sellvia ingestion is read-only via SELLVIA_RECONCILIATION_URL or SELLVIA_RECONCILIATION_FILE."
          : "Sellvia ingestion disabled in shopify-only mode.",
    };

    const summary = buildSummary(config, {
      startedAt,
      shopifyRecords,
      payouts,
      sellviaRecords,
      matches,
      unmatchedShopify,
      unmatchedSellvia,
      totals,
      rateLimitedRequests: counters.rateLimited,
      errors,
    });

    await writeArtifacts(config, summary, details);
    return { summary, details, config };
  } catch (error) {
    const safeError = sanitizeError(error);
    errors.push(safeError);

    const summary = {
      startedAt,
      completedAt: new Date().toISOString(),
      source: config.source,
      dryRun: config.dryRun,
      dateWindow: config.dateWindow,
      matchWindowDays: config.matchWindowDays,
      fetched: {
        shopifyOrders: 0,
        shopifyPayouts: 0,
        sellviaRecords: 0,
      },
      matches: {
        exact: 0,
        reviewNeeded: 0,
        unmatchedShopify: 0,
        unmatchedSellvia: 0,
      },
      totals: {
        grossSales: { status: "unavailable", value: null, currency: null, reason: "Run failed" },
        refunds: { status: "unavailable", value: null, currency: null, reason: "Run failed" },
        fees: { status: "unavailable", value: null, currency: null, reason: "Run failed" },
        netPayout: { status: "unavailable", value: null, currency: null, reason: "Run failed" },
        expectedAmount: { status: "unavailable", value: null, currency: null, reason: "Run failed" },
        actualPayout: { status: "unavailable", value: null, currency: null, reason: "Run failed" },
        variance: { status: "unavailable", value: null, currency: null, reason: "Run failed" },
      },
      rateLimitedRequests: counters.rateLimited,
      errors,
    };

    const details = {
      startedAt,
      completedAt: new Date().toISOString(),
      fatal: true,
      source: config.source,
      dryRun: config.dryRun,
      dateWindow: config.dateWindow,
      errors,
      adapterBoundary:
        config.source === "shopify-sellvia"
          ? "Sellvia ingestion is read-only via SELLVIA_RECONCILIATION_URL or SELLVIA_RECONCILIATION_FILE."
          : "Sellvia ingestion disabled in shopify-only mode.",
    };

    await writeArtifacts(config, summary, details);
    const wrapped = new Error(safeError);
    wrapped.summary = summary;
    throw wrapped;
  }
}
