const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 1_000;

class FatalRequestError extends Error {}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1_000));
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, parsed - Date.now());
}

function createTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  return controller.signal;
}

function joinSignals(signals) {
  const activeSignals = signals.filter(Boolean);
  if (activeSignals.length <= 1) {
    return activeSignals[0];
  }

  const controller = new AbortController();
  const abort = (signal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason || new Error('Aborted'));
    }
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }

    signal.addEventListener('abort', () => abort(signal), { once: true });
  }

  return controller.signal;
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export async function requestWithRetry(url, options = {}, runtime = {}) {
  const {
    fetchImpl = fetch,
    log = () => {},
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    deadlineAt,
    sleepImpl = sleep,
  } = runtime;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (deadlineAt && Date.now() >= deadlineAt) {
      throw new Error('Sync deadline reached before request could be attempted');
    }

    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: joinSignals([options.signal, createTimeoutSignal(timeoutMs)]),
      });

      if (response.ok) {
        const callLimit = response.headers?.get?.('x-shopify-shop-api-call-limit');
        if (callLimit) {
          const [used, total] = callLimit.split('/').map(Number);
          if (Number.isFinite(used) && Number.isFinite(total) && total > 0 && used / total >= 0.85 && attempt < maxAttempts) {
            await sleepImpl(Math.min(baseDelayMs, 2_000));
          }
        }

        return response;
      }

      if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
        const body = await response.text().catch(() => '');
        throw new FatalRequestError(
          `Request failed with status ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
        );
      }

      const retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'));
      const delayMs = retryAfterMs ?? Math.min(baseDelayMs * 2 ** (attempt - 1), 8_000);
      log(`Retrying ${url} after ${response.status} in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`);
      await sleepImpl(delayMs);
    } catch (error) {
      lastError = error;
      if (error instanceof FatalRequestError) {
        break;
      }
      if (attempt === maxAttempts) {
        break;
      }

      const message = error instanceof Error ? error.message : String(error);
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), 8_000);
      log(`Retrying ${url} after error: ${message} in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`);
      await sleepImpl(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
