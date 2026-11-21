import { randomUUID, createHash } from 'node:crypto';

export class QueueError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'QueueError';
    this.code = code;
  }
}

export const fail = (code, message) => { throw new QueueError(code, message); };
export function object(value, name = 'input') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT', `${name} must be an object`);
  return value;
}
export function text(value, name, regex, max = 255) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !regex.test(value)) fail('INVALID_INPUT', `Invalid ${name}`);
  return value;
}
export const account = value => text(value, 'accountId', /^acct_[A-Za-z0-9]+$/, 255);
export const paymentIntent = value => text(value, 'paymentIntentId', /^pi_[A-Za-z0-9]+$/, 255);
export const eventId = value => text(value, 'eventId', /^evt_[A-Za-z0-9]+$/, 255);
export const uuid = (value, name = 'id') => text(value, name, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 36);
export const currency = value => text(value, 'currency', /^[a-z]{3}$/, 3);
export function scope(accountId, livemode) {
  account(accountId);
  if (typeof livemode !== 'boolean') fail('INVALID_INPUT', 'livemode must be an explicit boolean');
  return { accountId, livemode };
}
export function amount(value, name = 'amount') {
  if (typeof value !== 'bigint' && !(typeof value === 'string' && /^[1-9][0-9]*$/.test(value))) fail('INVALID_INPUT', `${name} must be a positive bigint or canonical decimal string`);
  let n;
  try { n = BigInt(value); } catch { fail('INVALID_INPUT', `Invalid ${name}`); }
  if (n <= 0n || n > 9223372036854775807n) fail('INVALID_INPUT', `${name} is outside the positive PostgreSQL bigint range`);
  return n;
}
export function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_INPUT', `${name} must be an integer between ${min} and ${max}`);
  return value;
}
export function identifier(value, name) {
  return text(value, name, /^(?!\s*$)[^\x00-\x1f\x7f]+$/, 200);
}
export const newId = () => randomUUID();
export const tokenHash = token => createHash('sha256').update(token, 'utf8').digest('hex');
export function safeError(error) {
  if (error instanceof QueueError) throw error;
  // Never expose database connection strings, SQL parameters, or provider payloads.
  throw new QueueError('STORAGE_ERROR', 'Database operation failed');
}
