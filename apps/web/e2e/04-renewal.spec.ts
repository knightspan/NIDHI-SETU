import { expect, test } from '@playwright/test';
import { USERS, login, pdf, unique } from './helpers';

test('PS scenario 4 — renewal files a replacement and links the chain', async ({ page }) => {
  await login(page, USERS.institution);
  await page.goto('/instruments');
  await page
    .locator('tbody tr', { hasText: 'Expiring soon' })
    .first()
    .getByRole('link')
    .first()
    .click();
  await page.waitForURL(/\/instruments\/[0-9a-f-]{36}$/);
  const oldRef = (await page.getByRole('heading', { level: 1 }).textContent())!.match(
    /NS-\d{4}-\d{6}/,
  )![0];

  await page.getByRole('link', { name: 'Submit renewal / replacement' }).click();
  await page.waitForURL(/\/renew$/);
  await page.getByLabel(/FDR number/).fill(`SBI/FD/2026/R${unique()}`);
  await page.getByLabel(/Amount/).fill('1500000');
  const issue = new Date().toISOString().slice(0, 10);
  const maturity = `${Number(issue.slice(0, 4)) + 5}${issue.slice(4)}`;
  await page.getByLabel(/Issue date/).fill(issue);
  await page.getByLabel(/Maturity date/).fill(maturity);
  await page.getByLabel(/^Bank/).selectOption('SBIN');
  await page.getByRole('textbox', { name: 'Branch', exact: true }).fill('Civil Lines');
  await page.getByLabel(/IFSC/).fill('SBIN0004321');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/\/instruments\/[0-9a-f-]{36}$/);

  await page.locator('input[type=file]').setInputFiles(pdf('renewal-scan'));
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText('Document uploaded').first()).toBeVisible();
  await page.getByRole('button', { name: 'Submit for scrutiny' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit for scrutiny' }).click();
  await expect(page.getByText('Submitted for scrutiny').first()).toBeVisible();

  // The replacement chain shows the old deposit, which stays held until the new one is confirmed.
  await expect(page.getByRole('link', { name: oldRef }).first()).toBeVisible();
  await page.getByRole('link', { name: oldRef }).first().click();
  await expect(page.getByText('Renewal pending').first()).toBeVisible();
});
