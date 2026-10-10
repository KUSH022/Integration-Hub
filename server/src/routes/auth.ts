import { z } from 'zod';
import type { Response } from 'express';
import type { AppDeps } from '../context.js';
import { hashPassword, newId, signToken, verifyPassword } from '../core/crypto.js';
import { ROLES } from '../core/domain.js';
import { defineRoute, IdParam } from '../http/registry.js';
import { ApiError, badRequest, notFound } from '../http/errors.js';
import { SESSION_COOKIE } from '../http/middleware.js';
import { audit } from '../services/audit.js';

const Password = z.string().min(12, 'Password must be at least 12 characters').max(200);
const Email = z.string().trim().toLowerCase().email().max(200);
const PublicUser = z.object({ id: z.string(), email: z.string(), name: z.string().optional(), role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER']), active: z.boolean().optional() });

function cols(deps: AppDeps) {
  if (!deps.cols) throw new ApiError(503, 'DB_UNAVAILABLE', 'Database unavailable');
  return deps.cols;
}

function setSessionCookie(res: Response, deps: AppDeps, token: string | null) {
  const parts = [`${SESSION_COOKIE}=${token ? encodeURIComponent(token) : ''}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (deps.config.COOKIE_SECURE) parts.push('Secure');
  parts.push(token ? `Max-Age=${deps.config.SESSION_TTL_MINUTES * 60}` : 'Max-Age=0');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export async function createUser(deps: AppDeps, input: { email: string; name?: string; password: string; role: string }) {
  const now = deps.now();
  const doc = { _id: newId('usr'), email: input.email, name: input.name ?? '', passwordHash: await hashPassword(input.password), role: input.role, active: true, createdAt: now, updatedAt: now };
  await cols(deps).users.insertOne(doc as never);
  return { id: doc._id, email: doc.email, name: doc.name, role: doc.role, active: true };
}

defineRoute({
  method: 'post', path: '/api/auth/login', tag: 'Auth', access: 'PUBLIC',
  summary: 'Sign in with e-mail and password',
  description: 'Sets an HttpOnly session cookie. When issueToken=true the session token is also returned for non-browser clients (scripts, smoke tests) to send as "Authorization: Bearer".',
  body: z.object({ email: Email, password: z.string().min(1).max(200), issueToken: z.boolean().optional() }),
  response: z.object({ user: PublicUser, token: z.string().optional(), expiresAt: z.string() }),
  errors: [400, 401, 429],
  rateLimit: { windowMs: 15 * 60_000, max: 20 },
  exampleRequest: { email: 'admin@example.com', password: '********' },
  handler: async ({ body, res, deps }) => {
    const user = await cols(deps).users.findOne({ email: body.email });
    const ok = user && user.active && (await verifyPassword(body.password, user.passwordHash));
    if (!ok) {
      await audit(deps, { action: 'AUTH_LOGIN_FAILED', resourceType: 'user', resourceId: body.email, result: 'FAILURE', actor: body.email });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid e-mail or password');
    }
    const sid = newId('ses');
    const expiresAt = new Date(deps.now().getTime() + deps.config.SESSION_TTL_MINUTES * 60_000);
    await cols(deps).sessions.insertOne({ _id: sid as never, userId: String(user._id), createdAt: deps.now(), expiresAt });
    const token = signToken({ sub: String(user._id), role: user.role, email: user.email, sid }, deps.config.SESSION_SECRET, deps.config.SESSION_TTL_MINUTES * 60);
    setSessionCookie(res, deps, token);
    const actor = { id: String(user._id), email: user.email, role: user.role, sessionId: sid };
    await audit(deps, { action: 'AUTH_LOGIN', resourceType: 'user', resourceId: String(user._id), actor });
    return { body: { user: { id: String(user._id), email: user.email, name: user.name, role: user.role }, token: body.issueToken ? token : undefined, expiresAt: expiresAt.toISOString() } };
  },
});

defineRoute({
  method: 'post', path: '/api/auth/logout', tag: 'Auth', access: 'VIEWER',
  summary: 'Sign out and revoke the current session',
  response: z.object({ ok: z.boolean() }),
  handler: async ({ user, res, deps }) => {
    await cols(deps).sessions.deleteOne({ _id: user!.sessionId as never });
    setSessionCookie(res, deps, null);
    await audit(deps, { action: 'AUTH_LOGOUT', resourceType: 'user', resourceId: user!.id, actor: user });
    return { body: { ok: true } };
  },
});

defineRoute({
  method: 'get', path: '/api/auth/me', tag: 'Auth', access: 'VIEWER',
  summary: 'Current authenticated user',
  response: z.object({ user: PublicUser }),
  errors: [401],
  handler: async ({ user }) => ({ body: { user: { id: user!.id, email: user!.email, role: user!.role } } }),
});

defineRoute({
  method: 'post', path: '/api/auth/change-password', tag: 'Auth', access: 'VIEWER',
  summary: 'Change own password (revokes all other sessions)',
  body: z.object({ currentPassword: z.string().min(1).max(200), newPassword: Password }),
  response: z.object({ ok: z.boolean() }),
  errors: [400, 401],
  handler: async ({ user, body, deps }) => {
    const u = await cols(deps).users.findOne({ _id: user!.id as never });
    if (!u || !(await verifyPassword(body.currentPassword, u.passwordHash))) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    await cols(deps).users.updateOne({ _id: user!.id as never }, { $set: { passwordHash: await hashPassword(body.newPassword), updatedAt: deps.now() } });
    await cols(deps).sessions.deleteMany({ userId: user!.id, _id: { $ne: user!.sessionId as never } });
    await audit(deps, { action: 'AUTH_PASSWORD_CHANGED', resourceType: 'user', resourceId: user!.id, actor: user });
    return { body: { ok: true } };
  },
});

defineRoute({
  method: 'get', path: '/api/users', tag: 'Users', access: 'ADMIN',
  summary: 'List Hub users',
  response: z.object({ items: z.array(PublicUser) }),
  handler: async ({ deps }) => {
    const items = await cols(deps).users.find({}, { projection: { passwordHash: 0 } }).sort({ email: 1 }).limit(500).toArray();
    return { body: { items: items.map((u) => ({ id: String(u._id), email: u.email, name: u.name, role: u.role, active: u.active })) } };
  },
});

defineRoute({
  method: 'post', path: '/api/users', tag: 'Users', access: 'ADMIN', successStatus: 201,
  summary: 'Create a Hub user',
  body: z.object({ email: Email, name: z.string().max(100).optional(), password: Password, role: z.enum(ROLES as [string, ...string[]]) }),
  response: z.object({ user: PublicUser }),
  errors: [400, 409],
  handler: async ({ body, deps, user }) => {
    const created = await createUser(deps, body);
    await audit(deps, { action: 'USER_CREATED', resourceType: 'user', resourceId: created.id, actor: user, details: { email: created.email, role: created.role } });
    return { body: { user: created } };
  },
});

defineRoute({
  method: 'patch', path: '/api/users/:id', tag: 'Users', access: 'ADMIN',
  summary: 'Change a user role, active flag or reset password',
  params: IdParam,
  body: z.object({ role: z.enum(ROLES as [string, ...string[]]).optional(), active: z.boolean().optional(), name: z.string().max(100).optional(), password: Password.optional() }),
  response: z.object({ user: PublicUser }),
  errors: [400, 404],
  handler: async ({ params, body, deps, user }) => {
    if (params.id === user!.id && (body.active === false || (body.role && body.role !== 'ADMIN'))) throw badRequest('You cannot deactivate or demote your own account');
    const set: Record<string, unknown> = { updatedAt: deps.now() };
    if (body.role) set.role = body.role;
    if (body.active !== undefined) set.active = body.active;
    if (body.name !== undefined) set.name = body.name;
    if (body.password) set.passwordHash = await hashPassword(body.password);
    const r = await cols(deps).users.findOneAndUpdate({ _id: params.id as never }, { $set: set }, { returnDocument: 'after', projection: { passwordHash: 0 } });
    if (!r) throw notFound('User');
    if (body.active === false || body.password || body.role) await cols(deps).sessions.deleteMany({ userId: params.id });
    await audit(deps, { action: 'USER_UPDATED', resourceType: 'user', resourceId: params.id, actor: user, details: { role: body.role, active: body.active, passwordReset: Boolean(body.password) } });
    return { body: { user: { id: String(r._id), email: r.email, name: r.name, role: r.role, active: r.active } } };
  },
});
