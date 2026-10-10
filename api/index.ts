import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/src/app.js';
import { loadConfig } from '../server/src/config/env.js';
import { policyFromConfig, type AppDeps } from '../server/src/context.js';
import { createHttpClient } from '../server/src/core/httpClient.js';
import { connectMongo, ensureSchema, getCollections } from '../server/src/db/mongo.js';
import { createUser } from '../server/src/routes/auth.js';
import type { MongoClient, Db } from 'mongodb';

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;
let cachedDeps: AppDeps | null = null;
let cachedApp: ReturnType<typeof createApp> | null = null;
let initPromise: Promise<ReturnType<typeof createApp>> | null = null;

async function initServerless(): Promise<ReturnType<typeof createApp>> {
  if (cachedApp && cachedDeps) return cachedApp;
  const config = loadConfig();
  const policy = policyFromConfig(config);

  if (!cachedClient || !cachedDb) {
    const { client, db } = await connectMongo(config);
    cachedClient = client;
    cachedDb = db;
    try {
      await ensureSchema(db, (m) => console.log(`[db] ${m}`));
    } catch (e) {
      console.warn('[db] ensureSchema warning:', (e as Error).message);
    }
    const cols = getCollections(db);
    cachedDeps = {
      config,
      cols,
      policy,
      send: createHttpClient({ policy }),
      now: () => new Date(),
    };

    // First-run bootstrap admin creation
    try {
      if ((await cols.users.countDocuments({}, { limit: 1 })) === 0) {
        if (config.BOOTSTRAP_ADMIN_EMAIL && config.BOOTSTRAP_ADMIN_PASSWORD.length >= 12) {
          await createUser(cachedDeps, {
            email: config.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(),
            password: config.BOOTSTRAP_ADMIN_PASSWORD,
            role: 'ADMIN',
            name: 'Administrator',
          });
          console.log(`[auth] bootstrap admin created: ${config.BOOTSTRAP_ADMIN_EMAIL}`);
        }
      }
    } catch (e) {
      console.warn('[auth] bootstrap check warning:', (e as Error).message);
    }
  } else {
    cachedDeps = {
      config,
      cols: getCollections(cachedDb),
      policy,
      send: createHttpClient({ policy }),
      now: () => new Date(),
    };
  }

  cachedApp = createApp(cachedDeps);
  return cachedApp;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!initPromise) {
    initPromise = initServerless().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  const app = await initPromise;
  return app(req, res);
}
