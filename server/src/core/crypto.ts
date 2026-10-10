/**
 * Cryptography helpers built only on node:crypto (no paid or external services).
 * - AES-256-GCM encryption for connection secrets stored in the Hub database.
 * - scrypt password hashing.
 * - HMAC-SHA256 signed session tokens and signed, expiring references.
 */
import crypto from 'node:crypto';

export interface EncryptedSecret {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

function keyFrom(material: string): Buffer {
  // Accept a 32-byte base64 key or derive a key from a long passphrase.
  const b = Buffer.from(material, 'base64');
  if (b.length === 32) return b;
  if (material.length < 32) throw new Error('SECRETS_ENCRYPTION_KEY must be 32 bytes base64 or a passphrase of at least 32 characters');
  return crypto.createHash('sha256').update(material, 'utf8').digest();
}

export function encryptSecret(plain: string, keyMaterial: string): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(keyMaterial), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function decryptSecret(enc: EncryptedSecret, keyMaterial: string): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(keyMaterial), Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(enc.data, 'base64')), decipher.final()]).toString('utf8');
}

const SCRYPT_N = 16384;
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await new Promise<Buffer>((res, rej) =>
    crypto.scrypt(password, salt, 64, { N: SCRYPT_N, r: 8, p: 1 }, (err, key) => (err ? rej(err) : res(key))),
  );
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await new Promise<Buffer>((res, rej) =>
    crypto.scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: 8, p: 1 }, (err, key) => (err ? rej(err) : res(key))),
  );
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export interface TokenClaims {
  sub: string;
  role: string;
  email: string;
  sid: string;
  iat: number;
  exp: number;
}

export function signToken(claims: Omit<TokenClaims, 'iat' | 'exp'>, secret: string, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds }));
  const sig = b64url(crypto.createHmac('sha256', secret).update(`kphub.${body}`).digest());
  return `kphub.${body}.${sig}`;
}

export function verifyToken(token: string, secret: string): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'kphub') return null;
  const expected = crypto.createHmac('sha256', secret).update(`kphub.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as TokenClaims;
    if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Signed, expiring reference (e.g. to an immutable expected payload) that can be shared with KP QA Agent. */
export function signReference(resource: string, secret: string, ttlSeconds: number): { exp: number; sig: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = b64url(crypto.createHmac('sha256', secret).update(`ref.${resource}.${exp}`).digest());
  return { exp, sig };
}

export function verifyReference(resource: string, exp: number, sig: string, secret: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac('sha256', secret).update(`ref.${resource}.${exp}`).digest();
  const given = Buffer.from(sig, 'base64url');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export function sha256Json(v: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(v)).digest('hex');
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}
