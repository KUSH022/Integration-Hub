/**
 * Outbound HTTP client used for every call to KP WFM, KP QA Agent and other REST systems.
 * Built on node:http/https so that DNS answers can be validated at connect time (SSRF / DNS rebinding),
 * redirects are never followed automatically, and timeouts/response sizes are bounded.
 */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { assertResolvedAddressesAllowed, SsrfError, validateDestinationUrl, type SsrfPolicy } from './ssrf.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpRequest {
  url: string;
  method: HttpMethod;
  headers?: Record<string, string>;
  /** JSON body (serialised by the client). Ignored for GET/DELETE when undefined. */
  body?: unknown;
  timeoutMs: number;
  maxResponseBytes?: number;
}

export type HttpErrorKind = 'TIMEOUT' | 'NETWORK' | 'SSRF_BLOCKED' | 'INVALID_URL' | 'RESPONSE_TOO_LARGE';

export interface HttpSuccess {
  ok: true;
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson: unknown;
  truncated: boolean;
  durationMs: number;
}
export interface HttpFailure {
  ok: false;
  errorKind: HttpErrorKind;
  message: string;
  /** True when the request bytes were (or may have been) delivered to the destination. */
  requestSent: boolean;
  durationMs: number;
}
export type HttpResult = HttpSuccess | HttpFailure;

export type LookupFn = (hostname: string) => Promise<string[]>;

const defaultLookup: LookupFn = async (hostname) => {
  const res = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return res.map((r) => r.address);
};

export interface HttpClientOptions {
  policy: SsrfPolicy;
  lookup?: LookupFn;
  userAgent?: string;
}

export function createHttpClient(opts: HttpClientOptions) {
  const lookupFn = opts.lookup ?? defaultLookup;

  return async function send(req: HttpRequest): Promise<HttpResult> {
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    let url: URL;
    try {
      url = validateDestinationUrl(req.url, opts.policy);
    } catch (e) {
      return { ok: false, errorKind: e instanceof SsrfError ? 'SSRF_BLOCKED' : 'INVALID_URL', message: (e as Error).message, requestSent: false, durationMs: elapsed() };
    }
    const maxBytes = req.maxResponseBytes ?? 1_000_000;
    const hasBody = req.body !== undefined && req.method !== 'GET';
    const payload = hasBody ? Buffer.from(JSON.stringify(req.body), 'utf8') : undefined;
    const headers: Record<string, string> = {
      accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
      'user-agent': opts.userAgent ?? 'KP-Integration-Hub/1.0',
      ...(req.headers ?? {}),
    };
    if (payload) {
      headers['content-type'] = headers['content-type'] ?? 'application/json';
      headers['content-length'] = String(payload.length);
    }

    return new Promise<HttpResult>((resolve) => {
      let settled = false;
      let connected = false;
      const finish = (r: HttpResult) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(r);
        }
      };

      // Custom lookup: resolve, validate every answer, then connect to a validated address.
      const lookup = (hostname: string, options: { all?: boolean; family?: number } | number, cb: (...args: unknown[]) => void) => {
        lookupFn(hostname)
          .then((addresses) => {
            assertResolvedAddressesAllowed(hostname, addresses, opts.policy);
            const all = typeof options === 'object' && options?.all;
            if (all) cb(null, addresses.map((a) => ({ address: a, family: a.includes(':') ? 6 : 4 })));
            else cb(null, addresses[0], addresses[0].includes(':') ? 6 : 4);
          })
          .catch((err: Error) => cb(err));
      };

      const mod = url.protocol === 'https:' ? https : http;
      const r = mod.request(
        url,
        { method: req.method, headers, agent: false, lookup: lookup as unknown as typeof dns.lookup },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          let truncated = false;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) {
              truncated = true;
              const keep = maxBytes - (size - c.length);
              if (keep > 0) chunks.push(c.subarray(0, keep));
              res.destroy();
              return;
            }
            chunks.push(c);
          });
          const done = () => {
            const bodyText = Buffer.concat(chunks).toString('utf8');
            let bodyJson: unknown = undefined;
            if (!truncated && bodyText.length > 0) {
              try {
                bodyJson = JSON.parse(bodyText);
              } catch {
                bodyJson = undefined;
              }
            }
            const outHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) outHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
            finish({ ok: true, status: res.statusCode ?? 0, headers: outHeaders, bodyText, bodyJson, truncated, durationMs: elapsed() });
          };
          res.on('end', done);
          res.on('close', done);
          res.on('error', (err) => finish({ ok: false, errorKind: 'NETWORK', message: err.message, requestSent: true, durationMs: elapsed() }));
        },
      );

      r.on('socket', (s) => {
        s.once('connect', () => (connected = true));
        s.once('secureConnect', () => (connected = true));
      });

      const timer = setTimeout(() => {
        finish({ ok: false, errorKind: 'TIMEOUT', message: `No complete response within ${req.timeoutMs} ms`, requestSent: connected, durationMs: elapsed() });
        r.destroy(new Error('timeout'));
      }, req.timeoutMs);

      r.on('error', (err: Error & { code?: string }) => {
        if (err instanceof SsrfError) {
          finish({ ok: false, errorKind: 'SSRF_BLOCKED', message: err.message, requestSent: false, durationMs: elapsed() });
          return;
        }
        finish({ ok: false, errorKind: 'NETWORK', message: err.code ? `${err.code}: ${err.message}` : err.message, requestSent: connected, durationMs: elapsed() });
      });

      if (payload) r.write(payload);
      r.end();
    });
  };
}

export type SendFn = ReturnType<typeof createHttpClient>;
