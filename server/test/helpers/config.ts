import { loadConfig } from '../../src/config/env.js';

export function testConfig(over: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: process.env.MONGODB_URI_TEST ?? 'mongodb://unused-in-this-test',
    MONGODB_DB_NAME: `kp_hub_test_${process.pid}`,
    SESSION_SECRET: 's'.repeat(40),
    SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    REFERENCE_SIGNING_SECRET: 'r'.repeat(40),
    COOKIE_SECURE: 'false',
    CORS_ORIGINS: 'http://localhost:5173',
    ALLOW_PRIVATE_DESTINATIONS: 'true', // tests use local test-double servers on 127.0.0.1
    WORKER_ENABLED: 'false',
    JSON_BODY_LIMIT_KB: '16',
    ...over,
  } as NodeJS.ProcessEnv);
}
