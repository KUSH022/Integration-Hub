#!/usr/bin/env node
/**
 * Smoke tests for a running or deployed KP Integration Hub. These call REAL endpoints — nothing is mocked.
 *
 *   SMOKE_API_URL=https://your-api.example.com \
 *   SMOKE_WEB_URL=https://your-frontend.example.com \
 *   SMOKE_EMAIL=operator@example.com SMOKE_PASSWORD=... \
 *   node scripts/smoke.mjs
 *
 * Checks: backend liveness, database readiness, frontend availability (+ /api proxy), and — when credentials
 * are supplied — a real connection test for every configured KP WFM / KP QA Agent / REST connection.
 * Exit code is non-zero if any check fails.
 */
const API = (process.env.SMOKE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const WEB = process.env.SMOKE_WEB_URL?.replace(/\/+$/, '');
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
const WAKE_TIMEOUT_MS = Number(process.env.SMOKE_WAKE_TIMEOUT_MS ?? 180_000);

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function fetchJson(url, init = {}, timeoutMs = 30_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

async function waitForApi() {
  // Free-tier services may be asleep; keep trying until the wake timeout.
  const start = Date.now();
  let last = '';
  while (Date.now() - start < WAKE_TIMEOUT_MS) {
    try {
      const r = await fetchJson(`${API}/api/health`, {}, 60_000);
      if (r.status === 200 && r.body?.status === 'ok') return { ok: true, ms: Date.now() - start };
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { ok: false, last };
}

const health = await waitForApi();
record('Backend liveness (GET /api/health)', health.ok, health.ok ? `responded after ${health.ms} ms` : `no healthy response: ${health.last}`);

if (health.ok) {
  const ready = await fetchJson(`${API}/api/ready`).catch((e) => ({ status: 0, body: e.message }));
  record('Database connection (GET /api/ready)', ready.status === 200 && ready.body?.database === 'ok', `HTTP ${ready.status}`);
  const oa = await fetchJson(`${API}/api/openapi.json`).catch(() => ({ status: 0 }));
  record('OpenAPI document (GET /api/openapi.json)', oa.status === 200 && Boolean(oa.body?.paths), `${Object.keys(oa.body?.paths ?? {}).length} paths`);
  const unauth = await fetchJson(`${API}/api/integrations`).catch(() => ({ status: 0 }));
  record('Protected API rejects anonymous calls', unauth.status === 401, `HTTP ${unauth.status}`);
}

if (WEB) {
  const page = await fetch(WEB).then(async (r) => ({ status: r.status, text: await r.text() })).catch((e) => ({ status: 0, text: e.message }));
  record('Frontend serves the application shell', page.status === 200 && page.text.includes('KP Integration Hub'), `HTTP ${page.status}`);
  const proxied = await fetchJson(`${WEB}/api/health`, {}, 90_000).catch(() => ({ status: 0 }));
  record('Frontend /api proxy reaches the backend', proxied.status === 200, `HTTP ${proxied.status}`);
}

if (health.ok && EMAIL && PASSWORD) {
  const login = await fetchJson(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, issueToken: true }) });
  record('Sign in', login.status === 200 && Boolean(login.body?.token), `HTTP ${login.status}`);
  if (login.body?.token) {
    const auth = { authorization: `Bearer ${login.body.token}` };
    const conns = await fetchJson(`${API}/api/connections`, { headers: auth });
    const items = conns.body?.items ?? [];
    record('List connections', conns.status === 200, `${items.length} configured`);
    for (const c of items) {
      if (!c.healthCheck) {
        record(`Connection "${c.name}" (${c.application})`, false, 'no health-check endpoint configured — cannot be verified');
        continue;
      }
      const t = await fetchJson(`${API}/api/connections/${c._id}/test`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' }, 130_000);
      const r = t.body?.result;
      record(`Connection "${c.name}" (${c.application}) real health check`, t.status === 200 && r?.ok === true, r ? `${r.message} [${r.url}]` : `HTTP ${t.status} ${t.body?.error?.message ?? ''}`);
    }
    await fetchJson(`${API}/api/auth/logout`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' });
  }
} else if (health.ok) {
  console.log('SKIP  Connection checks — set SMOKE_EMAIL and SMOKE_PASSWORD (OPERATOR or ADMIN) to run real connection tests');
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
