import { expect, test } from '@playwright/test';
import { USERS, login, logout, pdf, unique } from './helpers';

test('PS scenario 1 — new FDR submission reaches the regional officer', async ({ page }) => {
  const fdr = `SBI/FD/2026/E2E${unique()}`;
  await login(page, USERS.institution2);

  // Declare the deposit exactly as printed on the FDR.
  await page.goto('/instruments/new');
  await page.getByLabel(/FDR number/).fill(fdr);
  await page.getByLabel(/Amount/).fill('2000000');
  await page.getByLabel(/Issue date/).fill('2026-10-01');
  await page.getByLabel(/Maturity date/).fill('2031-10-01');
  await page.getByLabel(/^Bank/).selectOption('SBIN');
  await page.getByRole('textbox', { name: 'Branch', exact: true }).fill('Civil Lines');
  await page.getByLabel(/IFSC/).fill('SBIN0004321');
  await page.getByLabel(/depositor names/i).fill('AICTE\nGYAN JYOTI TRUST');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/\/instruments\/[0-9a-f-]{36}$/);
  const refNo = (await page.getByRole('heading', { level: 1 }).textContent())!.match(
    /NS-\d{4}-\d{6}/,
  )![0];

  // Attach the scan and submit.
  await page.locator('input[type=file]').setInputFiles(pdf('fdr-scan'));
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText('Document uploaded').first()).toBeVisible();
  await page.getByRole('button', { name: 'Submit for scrutiny' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit for scrutiny' }).click();
  await expect(page.getByText('Submitted for scrutiny').first()).toBeVisible();
  await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();

  // Every value is recorded as "declared" until someone verifies it.
  await expect(page.getByText(fdr).first()).toBeVisible();

  // The regional officer for the institution's region sees it in the scrutiny queue.
  await logout(page);
  await login(page, USERS.roNorth);
  await page.goto('/scrutiny');
  await expect(page.getByRole('link', { name: refNo })).toBeVisible();
});
