import type { AppConfig } from './config/env.js';
import type { Collections } from './db/mongo.js';
import type { SendFn } from './core/httpClient.js';
import type { SsrfPolicy } from './core/ssrf.js';
import type { Role } from './core/domain.js';

export interface AppDeps {
  config: AppConfig;
  /** null when the database is unavailable (only health endpoints work then). */
  cols: Collections | null;
  send: SendFn;
  policy: SsrfPolicy;
  now: () => Date;
}

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  sessionId: string;
}

export function policyFromConfig(config: AppConfig): SsrfPolicy {
  return {
    allowPrivateNetworks: config.ALLOW_PRIVATE_DESTINATIONS,
    requireHttps: config.requireHttpsDestinations,
    allowedPorts: config.allowedDestinationPorts,
    allowedHosts: config.DESTINATION_HOST_ALLOWLIST,
  };
}
