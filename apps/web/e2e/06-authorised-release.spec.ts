import { expect, test } from '@playwright/test';
import { USERS, login, logout } from './helpers';

test('PS scenario 6 — release needs every precondition, a maker and a different checker', async ({
  page,
}) => {
  // An institution asks for a deposit it still needs: the checklist blocks it.
  await login(page, USERS.institution2);
  await page.goto('/instruments');
  await page
    .locator('tbody tr', { hasText: 'HDFC Bank' })
    .filter({ hasText: 'Active' })
    .first()
    .getByRole('link')
    .first()
    .click();
  await page.getByRole('button', { name: 'Request release' }).click();
  await page
    .getByRole('dialog')
    .getByLabel(/Reason for release/)
    .fill('Programme closed; we would like the deposit discharged.');
  await page.getByRole('dialog').getByRole('button', { name: 'Request release' }).click();
  await expect(page.getByText('Release requested').first()).toBeVisible();
  await expect(page.getByText(/preconditions? not met/).first()).toBeVisible();
  await expect(page.locator('[aria-label="failed"]').first()).toBeVisible();

  // A request whose checklist passes: the bureau officer recommends it (maker).
  await logout(page);
  await login(page, USERS.bureau);
  await page.goto('/releases');
  const ready = page
    .locator('tbody tr')
    .filter({ has: page.locator('[aria-label="All preconditions met"]') })
    .filter({ hasText: 'Awaiting recommendation' });
  await ready.first().getByRole('link').first().click();
  await page.waitForURL(/\/instruments\/[0-9a-f-]{36}$/);
  const path = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Recommend' }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Note')
    .fill('All preconditions verified against the record.');
  await page.getByRole('dialog').getByRole('button', { name: 'Recommend' }).click();
  await expect(page.getByText('Awaiting decision').first()).toBeVisible();
  // The maker cannot also approve.
  await expect(page.getByRole('button', { name: 'Approve release' })).toHaveCount(0);

  // The competent authority approves (checker).
  await logout(page);
  await login(page, USERS.authority);
  await page.goto(path);
  await page.getByRole('button', { name: 'Approve release' }).click();
  await page.getByRole('dialog').getByLabel('Note').fill('Approved under delegated powers.');
  await page.getByRole('dialog').getByRole('button', { name: 'Approve release' }).click();
  await expect(page.getByText('Awaiting execution').first()).toBeVisible();

  // Finance records the discharge done outside the portal; the portal never moves money.
  await logout(page);
  await login(page, USERS.finance);
  await page.goto(path);
  await page.getByRole('button', { name: 'Record execution' }).click();
  await page
    .getByRole('dialog')
    .getByLabel(/Execution reference/)
    .fill('FIN/REL/2026/E2E');
  await page.getByRole('dialog').getByRole('button', { name: 'Record execution' }).click();
  await expect(page.getByText('Released', { exact: true }).first()).toBeVisible();

  // Every step is in the tamper-evident audit trail.
  await logout(page);
  await login(page, USERS.auditor);
  await page.goto('/audit');
  await expect(page.getByText(/release\.executed/).first()).toBeVisible();
});
