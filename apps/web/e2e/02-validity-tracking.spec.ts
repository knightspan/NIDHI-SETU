import { expect, test } from '@playwright/test';
import { USERS, login, logout } from './helpers';

test('PS scenario 2 — validity of every deposit is tracked and visible', async ({ page }) => {
  // Oversight: the bureau sees the validity mix of everything AICTE holds.
  await login(page, USERS.bureau);
  await expect(page.getByRole('heading', { name: 'Validity of held deposits' })).toBeVisible();
  for (const label of ['Valid', 'Expiring soon', 'Overdue renewal'])
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();

  // Filter the register down to deposits that are about to expire.
  await page.goto('/instruments');
  await page.getByLabel('Validity').selectOption('EXPIRING_SOON');
  await expect(page).toHaveURL(/validity=EXPIRING_SOON/);
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) await expect(rows.nth(i)).toContainText('Expiring soon');

  // The institution sees the same status on its own deposit.
  await logout(page);
  await login(page, USERS.institution);
  await page.goto('/instruments');
  await expect(page.locator('tbody tr', { hasText: 'Expiring soon' }).first()).toBeVisible();
});
