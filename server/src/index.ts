import type { Server } from 'node:http';
import { createApp } from './createApp.js';
import { loadConfig } from './config/env.js';
import { policyFromConfig, type AppDeps } from './context.js';
import { createHttpClient } from './core/httpClient.js';
import { connectMongo, ensureSchema, getCollections } from './db/mongo.js';
import { createUser } from './routes/auth.js';
import { startWorker } from './services/worker.js';

async function main() {
  const config = loadConfig();
  const policy = policyFromConfig(config);
  const { client, db } = await connectMongo(config);
  await ensureSchema(db, (m) => console.log(`[db] ${m}`));
  const cols = getCollections(db);
  const deps: AppDeps = { config, cols, policy, send: createHttpClient({ policy }), now: () => new Date() };

  // First-run bootstrap: create an admin only when no users exist. Never resets existing data.
  if ((await cols.users.countDocuments({}, { limit: 1 })) === 0) {
    if (config.BOOTSTRAP_ADMIN_EMAIL && config.BOOTSTRAP_ADMIN_PASSWORD.length >= 12) {
      await createUser(deps, { email: config.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(), password: config.BOOTSTRAP_ADMIN_PASSWORD, role: 'ADMIN', name: 'Administrator' });
      console.log(`[auth] bootstrap admin created: ${config.BOOTSTRAP_ADMIN_EMAIL}. Remove BOOTSTRAP_ADMIN_PASSWORD from the environment now.`);
    } else {
      console.warn('[auth] no users exist. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (>= 12 chars) and restart to create the first admin.');
    }
  }

  const app = createApp(deps);
  const server: Server = app.listen(config.PORT, () => console.log(`[http] KP Integration Hub API listening on :${config.PORT} (${config.NODE_ENV})`));
  server.requestTimeout = 60_000;
  server.headersTimeout = 65_000;
  const worker = config.WORKER_ENABLED ? startWorker(deps) : null;

  const shutdown = async (signal: string) => {
    console.log(`[app] ${signal} received, shutting down`);
    server.close();
    await worker?.stop();
    await client.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  console.error(`[app] startup failed: ${(e as Error).message}`);
  process.exit(1);
});
