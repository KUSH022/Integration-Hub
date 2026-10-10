import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AppDeps, AuthUser } from '../context.js';
import { verifyToken } from '../core/crypto.js';
import type { Role } from '../core/domain.js';
import { redactUrl } from '../core/redact.js';
import { ApiError } from './errors.js';

export const SESSION_COOKIE = 'kphub_session';
export const CSRF_HEADER = 'x-kp-hub-client';

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  (req as Request & { id?: string }).id = id;
  res.setHeader('X-Request-ID', id);
  next();
}

export function securityHeaders(isProduction: boolean) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.removeHeader('X-Powered-By');
    next();
  };
}

/** CORS allowlist. CORS is not authentication; it only limits which browser origins may call the API. */
export function corsAllowlist(origins: string[]) {
  const allowed = new Set(origins.map((o) => o.replace(/\/+$/, '')));
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.header('origin');
    if (origin) {
      if (!allowed.has(origin)) {
        if (req.method === 'OPTIONS') return res.status(403).end();
        // Non-preflight cross-origin request from a disallowed origin: no CORS headers are sent, so the
        // browser blocks access to the response. Unsafe methods are rejected outright.
        if (!['GET', 'HEAD'].includes(req.method)) return res.status(403).json({ error: { code: 'CORS_REJECTED', message: 'Origin not allowed' } });
        return next();
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-ID');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
        res.setHeader('Access-Control-Allow-Headers', `Content-Type, Authorization, X-Request-ID, ${CSRF_HEADER}`);
        res.setHeader('Access-Control-Max-Age', '600');
        return res.status(204).end();
      }
    }
    next();
  };
}

/** Fixed-window in-memory rate limiter (per process). Suitable for a single free-tier instance. */
export function rateLimit(opts: { windowMs: number; max: number; key?: (req: Request) => string; name: string }) {
  const hits = new Map<string, { count: number; reset: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, Math.max(opts.windowMs, 30_000)).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${opts.name}:${opts.key ? opts.key(req) : req.ip}`;
    let e = hits.get(key);
    if (!e || e.reset < now) {
      e = { count: 0, reset: now + opts.windowMs };
      hits.set(key, e);
    }
    e.count++;
    res.setHeader('RateLimit-Limit', String(opts.max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, opts.max - e.count)));
    if (e.count > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((e.reset - now) / 1000)));
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests; please retry later' } });
    }
    next();
  };
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * Resolves the authenticated user from the session cookie (browser) or an Authorization: Bearer header
 * (scripts/smoke tests). Sessions are checked against the sessions collection so logout revokes them.
 * Cookie-authenticated unsafe requests must carry the X-KP-Hub-Client header (CSRF defence).
 */
export function authenticate(deps: AppDeps) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const authz = req.header('authorization');
      const bearer = authz?.startsWith('Bearer ') ? authz.slice(7) : undefined;
      const cookie = readCookie(req, SESSION_COOKIE);
      const token = bearer ?? cookie;
      if (!token) return next();
      const claims = verifyToken(token, deps.config.SESSION_SECRET);
      if (!claims) return next();
      if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.header(CSRF_HEADER) !== 'web') {
        throw new ApiError(403, 'CSRF_REJECTED', 'Missing client header for cookie-authenticated request');
      }
      if (!deps.cols) return next();
      const session = await deps.cols.sessions.findOne({ _id: claims.sid as unknown as never, userId: claims.sub });
      if (!session || new Date(session.expiresAt) < new Date()) return next();
      const user = await deps.cols.users.findOne({ _id: claims.sub as unknown as never, active: true });
      if (!user) return next();
      (req as Request & { user?: AuthUser }).user = { id: String(user._id), email: user.email, role: user.role as Role, sessionId: claims.sid };
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on('finish', () => {
    const id = (req as Request & { id?: string }).id;
    // Only method, redacted path, status and duration are logged: never headers or bodies.
    console.log(JSON.stringify({ t: new Date().toISOString(), id, m: req.method, p: redactUrl(`http://x${req.originalUrl}`).slice(8), s: res.statusCode, ms: Date.now() - start }));
  });
  next();
}

export function errorHandler(isProduction: boolean) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = (req as Request & { id?: string }).id;
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId } });
    }
    const e = err as { type?: string; status?: number; code?: number; message?: string };
    if (e?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the configured size limit', requestId } });
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON', requestId } });
    if (e?.code === 11000) return res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with the same unique value already exists', requestId } });
    console.error(JSON.stringify({ t: new Date().toISOString(), id: requestId, level: 'error', message: e?.message ?? String(err) }));
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: isProduction ? 'An unexpected error occurred' : (e?.message ?? 'Unexpected error'), requestId } });
  };
}
