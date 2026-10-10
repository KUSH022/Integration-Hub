import express from 'express';
import type { AppDeps } from './context.js';
import { mountRoutes, routes, type RouteDef } from './http/registry.js';
import { authenticate, corsAllowlist, errorHandler, rateLimit, requestId, requestLogger, securityHeaders } from './http/middleware.js';
import './routes/auth.js';
import './routes/connections.js';
import './routes/integrations.js';
import './routes/runs.js';
import './routes/qaAgent.js';
import './routes/system.js';

export function createApp(deps: AppDeps, opts: { logRequests?: boolean } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.config.TRUST_PROXY);
  app.use(requestId);
  if (opts.logRequests !== false) app.use(requestLogger);
  app.use(securityHeaders(deps.config.isProduction));
  app.use(corsAllowlist(deps.config.CORS_ORIGINS));
  app.use(rateLimit({ name: 'global', windowMs: 60_000, max: deps.config.RATE_LIMIT_PER_MINUTE }));
  app.use(express.json({ limit: `${deps.config.JSON_BODY_LIMIT_KB}kb`, strict: true }));
  app.use(authenticate(deps));

  const router = express.Router();
  const limiters = new Map<RouteDef, ReturnType<typeof rateLimit>>();
  mountRoutes(router, deps, routes, (def) => {
    if (!def.rateLimit) return [];
    if (!limiters.has(def)) {
      const max = def.path === '/api/auth/login' ? deps.config.LOGIN_RATE_LIMIT_PER_15_MIN : def.rateLimit.max;
      limiters.set(def, rateLimit({ name: `${def.method}:${def.path}`, windowMs: def.rateLimit.windowMs, max }));
    }
    return [limiters.get(def)];
  });
  app.use(router);
  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } }));
  app.use(errorHandler(deps.config.isProduction));
  return app;
}
