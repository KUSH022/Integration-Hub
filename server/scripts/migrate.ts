/**
 * Creates/updates collections, validators and indexes in the Hub database. Idempotent and non-destructive.
 * Usage: npm run db:migrate --workspace server
 */
import { loadConfig } from '../src/config/env.js';
import { connectMongo, ensureSchema } from '../src/db/mongo.js';

const config = loadConfig();
const { client, db } = await connectMongo(config);
try {
  await ensureSchema(db, (m) => console.log(`[migrate] ${m}`));
  console.log(`[migrate] database "${config.MONGODB_DB_NAME}" is ready`);
} finally {
  await client.close();
}
