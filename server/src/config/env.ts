import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const list = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(4000, 1, 65535),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().regex(/^[A-Za-z0-9_-]{1,38}$/).default('kp_integration_hub'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SECRETS_ENCRYPTION_KEY: z.string().min(32, 'SECRETS_ENCRYPTION_KEY must be a 32-byte base64 key or >=32 character passphrase'),
  REFERENCE_SIGNING_SECRET: z.string().min(32, 'REFERENCE_SIGNING_SECRET must be at least 32 characters'),
  QA_AGENT_API_KEY: z.string().optional().default(''),
  CRON_SECRET: z.string().optional().default(''),
  SESSION_TTL_MINUTES: int(480, 5, 7 * 24 * 60),
  COOKIE_SECURE: bool(true),
  CORS_ORIGINS: list,
  PUBLIC_API_BASE_URL: z.string().optional().default(''),
  TRUST_PROXY: int(1, 0, 10),
  JSON_BODY_LIMIT_KB: int(1024, 16, 10240),
  RATE_LIMIT_PER_MINUTE: int(300, 10, 100000),
  LOGIN_RATE_LIMIT_PER_15_MIN: int(20, 3, 1000),
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional().default(''),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional().default(''),
  ALLOW_PRIVATE_DESTINATIONS: bool(false),
  REQUIRE_HTTPS_DESTINATIONS: z.string().optional(),
  ALLOWED_DESTINATION_PORTS: list,
  DESTINATION_HOST_ALLOWLIST: list,
  WORKER_ENABLED: bool(true),
  WORKER_POLL_MS: int(2000, 250, 60000),
  WORKER_CONCURRENCY: int(2, 1, 10),
  RUN_LEASE_SECONDS: int(300, 30, 3600),
  RUN_RETENTION_DAYS: int(0, 0, 3650),
  SOURCE_RETENTION_DAYS: int(0, 0, 3650),
  AUDIT_RETENTION_DAYS: int(0, 0, 3650),
  MAX_RECORDS_PER_SUBMISSION: int(500, 1, 5000),
});

export type RawEnv = z.infer<typeof EnvSchema>;

export interface AppConfig extends RawEnv {
  isProduction: boolean;
  requireHttpsDestinations: boolean;
  allowedDestinationPorts: number[] | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${msg}`);
  }
  const c = parsed.data;
  const isProduction = c.NODE_ENV === 'production';
  const requireHttps = c.REQUIRE_HTTPS_DESTINATIONS === undefined || c.REQUIRE_HTTPS_DESTINATIONS === '' ? isProduction : ['1', 'true', 'yes'].includes(c.REQUIRE_HTTPS_DESTINATIONS.toLowerCase());
  const ports = c.ALLOWED_DESTINATION_PORTS.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
  if (isProduction) {
    if (c.CORS_ORIGINS.length === 0) console.warn('[config] CORS_ORIGINS is empty: browser POST/PUT/DELETE requests (which carry an Origin header) will be rejected. Set it to the frontend origin.');
    if (c.ALLOW_PRIVATE_DESTINATIONS) console.warn('[config] ALLOW_PRIVATE_DESTINATIONS=true in production: SSRF protection for private networks is disabled.');
    if (!c.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
  }
  return {
    ...c,
    isProduction,
    requireHttpsDestinations: requireHttps,
    allowedDestinationPorts: ports.length ? ports : isProduction ? [443] : null,
  };
}
