/**
 * Bounded retry decisions. Non-idempotent requests (POST, PATCH) are only retried when either
 * (a) the request provably never reached the destination, or
 * (b) the destination is configured as supporting an idempotency key and one is sent.
 */
import type { HttpMethod, HttpResult } from './httpClient.js';

export const MAX_RETRY_COUNT = 5;
export const MAX_RETRY_DELAY_MS = 60_000;

export interface RetryPolicy {
  retryCount: number; // additional attempts after the first
  retryDelayMs: number;
  backoff: 'FIXED' | 'EXPONENTIAL';
  retryOnStatus: number[]; // e.g. [408, 429, 502, 503, 504]
}

export const DEFAULT_RETRY_STATUSES = [408, 429, 502, 503, 504];

export function isIdempotentMethod(m: HttpMethod) {
  return m === 'GET' || m === 'PUT' || m === 'DELETE';
}

export interface RetryDecision {
  retry: boolean;
  reason: string;
}

export function decideRetry(params: {
  attempt: number; // 1-based attempt that just finished
  policy: RetryPolicy;
  method: HttpMethod;
  idempotencyKeySent: boolean;
  result: HttpResult;
  successStatuses: number[];
}): RetryDecision {
  const { attempt, policy, method, idempotencyKeySent, result, successStatuses } = params;
  const maxAttempts = 1 + Math.min(Math.max(policy.retryCount, 0), MAX_RETRY_COUNT);
  if (result.ok && successStatuses.includes(result.status)) return { retry: false, reason: 'Success status received' };
  if (attempt >= maxAttempts) return { retry: false, reason: `Retry limit reached (${maxAttempts} attempts)` };

  if (!result.ok) {
    if (result.errorKind === 'SSRF_BLOCKED' || result.errorKind === 'INVALID_URL') return { retry: false, reason: 'Destination blocked or invalid; not retryable' };
    if (!result.requestSent) return { retry: true, reason: 'Request was not delivered (connection failure); safe to retry' };
    if (isIdempotentMethod(method) || idempotencyKeySent) return { retry: true, reason: `${result.errorKind} after request was sent; retrying because the operation is idempotent` };
    return { retry: false, reason: `${result.errorKind} after a non-idempotent ${method} was sent; the destination may have processed it, so it is not retried automatically` };
  }

  if (!policy.retryOnStatus.includes(result.status)) return { retry: false, reason: `HTTP ${result.status} is not configured as retryable` };
  // 429/503 usually mean "not processed", but only retry non-idempotent calls if an idempotency key protects them.
  if (isIdempotentMethod(method) || idempotencyKeySent) return { retry: true, reason: `HTTP ${result.status} is retryable` };
  if (result.status === 429) return { retry: true, reason: 'HTTP 429 (rate limited) indicates the request was not processed' };
  return { retry: false, reason: `HTTP ${result.status} on non-idempotent ${method} without an idempotency key; not retried to avoid duplicates` };
}

export function retryDelay(policy: RetryPolicy, attempt: number): number {
  const base = Math.min(Math.max(policy.retryDelayMs, 0), MAX_RETRY_DELAY_MS);
  const d = policy.backoff === 'EXPONENTIAL' ? base * 2 ** (attempt - 1) : base;
  return Math.min(d, MAX_RETRY_DELAY_MS);
}
