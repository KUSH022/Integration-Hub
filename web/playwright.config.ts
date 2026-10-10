import { defineConfig } from '@playwright/test';

// Browser smoke tests against a running/deployed frontend. Set SMOKE_BASE_URL (and optionally
// SMOKE_EMAIL / SMOKE_PASSWORD for a VIEWER account). Uses only free, local browsers.
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  use: { baseURL: process.env.SMOKE_BASE_URL ?? 'http://localhost:5173', trace: 'off' },
});
