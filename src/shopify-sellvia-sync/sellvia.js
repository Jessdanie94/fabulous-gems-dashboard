import fs from 'node:fs/promises';
import path from 'node:path';
import { requestWithRetry } from './http.js';

function resolveUrl(baseUrl, endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return new URL(endpoint, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.catalog)) return payload.catalog;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data?.products)) return payload.data.products;
  return [];
}

function extractNextPage(payload) {
  return (
    payload?.next_page ??
    payload?.nextPage ??
    payload?.pagination?.next_page ??
    payload?.pagination?.nextPage ??
    payload?.meta?.next_page ??
    payload?.meta?.nextPage ??
    payload?.next_cursor ??
    payload?.nextCursor ??
    payload?.pageInfo?.nextCursor ??
    null
  );
}

export function createSellviaClient(config) {
  const headers = {
    Authorization: ['Bearer', config.sellviaAccessToken].join(' '),
    'Content-Type': 'application/json',
  };

  return {
    async listCatalogProducts() {
      if (config.catalogFixturePath) {
        const fixture = await fs.readFile(path.resolve(config.catalogFixturePath), 'utf8');
        const parsed = JSON.parse(fixture);
        return extractArray(parsed);
      }

      const records = [];
      let nextPage = 1;
      let iteration = 0;
      const seenPageTokens = new Set();
      while (nextPage && iteration < 100) {
        const currentPageToken = nextPage;
        const url = new URL(resolveUrl(config.sellviaBaseUrl, config.sellviaCatalogEndpoint));
        if (typeof nextPage === 'number') {
          url.searchParams.set('page', String(nextPage));
        } else {
          url.searchParams.set('cursor', String(nextPage));
        }
        url.searchParams.set('limit', String(config.pageSize));

        const response = await requestWithRetry(url.toString(), { headers }, config.requestRuntime);
        const payload = await response.json();
        const pageRecords = extractArray(payload);
        records.push(...pageRecords);

        const pageToken = extractNextPage(payload);
        if (!pageToken || !pageRecords.length) {
          nextPage = typeof currentPageToken === 'number' && pageRecords.length >= config.pageSize
            ? currentPageToken + 1
            : null;
        } else if (typeof pageToken === 'number' || /^\d+$/.test(String(pageToken))) {
          nextPage = Number(pageToken);
        } else {
          nextPage = pageToken;
        }

        const normalizedToken = String(nextPage);
        if (nextPage && seenPageTokens.has(normalizedToken)) {
          nextPage = null;
        } else if (nextPage) {
          seenPageTokens.add(normalizedToken);
        }
        iteration += 1;
      }

      return records;
    },
  };
}
