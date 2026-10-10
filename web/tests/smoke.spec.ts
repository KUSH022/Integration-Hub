import { test, expect } from '@playwright/test';

test('frontend loads and shows the sign-in page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('KP Integration Hub').first()).toBeVisible();
});

test('backend is reachable through the frontend origin (/api/health)', async ({ request }) => {
  const r = await request.get('/api/health');
  expect(r.status()).toBe(200);
  expect((await r.json()).status).toBe('ok');
});

test('database readiness through the frontend origin (/api/ready)', async ({ request }) => {
  const r = await request.get('/api/ready');
  expect(r.status()).toBe(200);
});

test('sign in and open the dashboard', async ({ page }) => {
  test.skip(!process.env.SMOKE_EMAIL || !process.env.SMOKE_PASSWORD, 'Set SMOKE_EMAIL and SMOKE_PASSWORD to run');
  await page.goto('/');
  await page.getByLabel('E-mail').fill(process.env.SMOKE_EMAIL!);
  await page.getByLabel('Password').fill(process.env.SMOKE_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
