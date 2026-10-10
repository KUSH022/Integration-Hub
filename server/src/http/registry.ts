/**
 * Route registry. Every Hub endpoint is declared here with its Zod schemas, so request validation,
 * authorization and the generated OpenAPI document all come from the same implemented definitions.
 */
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import type { AppDeps, AuthUser } from '../context.js';
import type { Role } from '../core/domain.js';
import { ApiError, forbidden, unauthorized } from './errors.js';

export type AccessLevel = 'PUBLIC' | Role;
const RANK: Record<Role, number> = { VIEWER: 1, OPERATOR: 2, ADMIN: 3 };

export interface HandlerCtx<B, Q, P> {
  req: Request;
  res: Response;
  body: B;
  query: Q;
  params: P;
  user: AuthUser | null;
  deps: AppDeps;
}

export interface HandlerResult {
  status?: number;
  body?: unknown;
  /** Set when the handler wrote the response itself. */
  handled?: boolean;
}

export interface RouteDef<B = any, Q = any, P = any> {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string; // express style, e.g. /api/integrations/:id
  tag: string;
  summary: string;
  description?: string;
  access: AccessLevel;
  body?: z.ZodType<B>;
  query?: z.ZodType<Q>;
  params?: z.ZodType<P>;
  response?: z.ZodType;
  successStatus?: number;
  errors?: number[];
  exampleRequest?: unknown;
  exampleResponse?: unknown;
  rateLimit?: { windowMs: number; max: number };
  handler: (ctx: HandlerCtx<B, Q, P>) => Promise<HandlerResult>;
}

export const routes: RouteDef[] = [];

export function defineRoute<B, Q, P>(def: RouteDef<B, Q, P>): RouteDef<B, Q, P> {
  routes.push(def as RouteDef);
  return def;
}

function zodDetails(err: z.ZodError) {
  return err.issues.map((i) => ({ field: i.path.join('.') || '(body)', code: i.code, message: i.message }));
}

export function mountRoutes(router: Router, deps: AppDeps, defs: RouteDef[], middlewareFor: (def: RouteDef) => any[]) {
  for (const def of defs) {
    router[def.method](def.path, ...middlewareFor(def), async (req: Request, res: Response, next: (e?: unknown) => void) => {
      try {
        const user = ((req as unknown as { user?: AuthUser }).user ?? null) as AuthUser | null;
        if (def.access !== 'PUBLIC') {
          if (!user) throw unauthorized();
          if (RANK[user.role] < RANK[def.access]) throw forbidden(`This action requires the ${def.access} role`);
        }
        const parse = <T>(schema: z.ZodType<T> | undefined, value: unknown, where: string): T => {
          if (!schema) return value as T;
          const r = schema.safeParse(value ?? {});
          if (!r.success) throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${where}`, zodDetails(r.error));
          return r.data;
        };
        const ctx: HandlerCtx<unknown, unknown, unknown> = {
          req,
          res,
          user,
          deps,
          params: parse(def.params, req.params, 'path parameters'),
          query: parse(def.query, req.query, 'query parameters'),
          body: parse(def.body, req.body, 'request body'),
        };
        const result = await def.handler(ctx as HandlerCtx<any, any, any>);
        if (result.handled) return;
        res.status(result.status ?? def.successStatus ?? 200).json(result.body ?? {});
      } catch (e) {
        next(e);
      }
    });
  }
}

/** Shared schema helpers */
export const Pagination = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const IdParam = z.object({ id: z.string().min(3).max(80).regex(/^[A-Za-z0-9_-]+$/) });

export function paged<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), page: z.number(), pageSize: z.number(), total: z.number() });
}

export const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.any().optional(), requestId: z.string().optional() }),
});
