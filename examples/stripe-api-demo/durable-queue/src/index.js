import clientPackage from '../generated/client/index.js';
import { createQueue } from './queue.js';
import { QueueError } from './validation.js';

const { PrismaClient } = clientPackage;

// Pass an injected client only when it points to the dedicated queue database.
export function createStripePrismaClient({ databaseUrl = process.env.STRIPE_DATABASE_URL } = {}) {
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) throw new QueueError('INVALID_DATABASE_URL', 'STRIPE_DATABASE_URL is required');
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw new QueueError('INVALID_DATABASE_URL', 'STRIPE_DATABASE_URL must be a PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
    throw new QueueError('INVALID_DATABASE_URL', 'STRIPE_DATABASE_URL must be a PostgreSQL URL naming a database');
  }
  return new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
}

export { createQueue, QueueError };
