import { expect, test } from '@playwright/test';
import { USERS, login, logout } from './helpers';

test.afterAll(async ({ browser }) => {
  // Put the shared demo clock back for the other scenarios.
  const page = await browser.newPage();
  await login(page, USERS.admin);
  await page.goto('/admin/clock');
  await page.getByRole('button', { name: 'Reset to real date' }).click();
  await expect(page.getByText(/Clock moved to/).first()).toBeVisible({ timeout: 60_000 });
  await page.close();
});

test('PS scenario 3 — approaching maturity triggers reminders as time passes', async ({ page }) => {
  // The seeded deposit matures in ~44 days: the 60-day reminder has already gone out.
  await login(page, USERS.institution);
  await page.goto('/notifications');
  const reminders = page.getByText(/matures in \d+ day/);
  await expect(reminders.first()).toBeVisible();
  await expect(page.getByText(/matures in [1-7] day/)).toHaveCount(0);

  // Move the demo clock forward 40 days; the lifecycle job runs and sends the next reminder.
  await logout(page);
  await login(page, USERS.admin);
  await page.goto('/admin/clock');
  const target = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Set a specific date').fill(target);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText(/Clock moved to/).first()).toBeVisible({ timeout: 60_000 });

  await logout(page);
  await login(page, USERS.institution);
  await page.goto('/notifications');
  // 4 days left: the 30- and 7-day offsets were crossed; only the nearest is announced.
  await expect(page.getByText(/matures in [1-7] day/).first()).toBeVisible();
  await expect(page.getByText(/reminder T-7/).first()).toBeVisible();
});
