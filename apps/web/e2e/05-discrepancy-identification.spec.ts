import { expect, test, type Page } from '@playwright/test';
import { USERS, login, logout, pdf, unique } from './helpers';

async function declareAndSubmit(page: Page): Promise<string> {
  await page.goto('/instruments/new');
  await page.getByLabel(/FDR number/).fill(`PNB-FDR-E${unique()}`);
  await page.getByLabel(/Amount/).fill('2000000');
  await page.getByLabel(/Issue date/).fill('2026-09-15');
  await page.getByLabel(/Maturity date/).fill('2031-09-15');
  await page.getByLabel(/^Bank/).selectOption('PUNB');
  await page.getByRole('textbox', { name: 'Branch', exact: true }).fill('Station Road');
  await page.getByLabel(/IFSC/).fill('PUNB0123400');
  await page.getByLabel(/depositor names/i).fill('AICTE\nGYAN JYOTI TRUST');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/\/instruments\/[0-9a-f-]{36}$/);
  await page.locator('input[type=file]').setInputFiles(pdf('mismatch-scan'));
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText('Document uploaded').first()).toBeVisible();
  await page.getByRole('button', { name: 'Submit for scrutiny' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit for scrutiny' }).click();
  await expect(page.getByText('Submitted for scrutiny').first()).toBeVisible();
  return new URL(page.url()).pathname;
}

test('PS scenario 5 — discrepancies are identified, sent back and answered', async ({ page }) => {
  await login(page, USERS.institution2);
  const path = await declareAndSubmit(page);

  // The officer compares the declaration with the original and records what the FDR really says.
  await logout(page);
  await login(page, USERS.roNorth);
  await page.goto(path);
  await page.getByRole('button', { name: 'Begin scrutiny' }).click();
  await expect(page.getByText('Scrutiny started').first()).toBeVisible();
  await page.getByRole('button', { name: /Correct… Amount/ }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('200000');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();

  // The rule engine flags the disagreement between sources on its own.
  const mismatch = page.locator('article[aria-label="Source mismatch"]');
  await expect(mismatch).toBeVisible();
  await expect(mismatch).toContainText('Detected automatically');

  // The officer adds a discrepancy of their own and sends the record back.
  await page.getByRole('button', { name: 'Raise discrepancy' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Related field').selectOption('amount');
  await dialog
    .getByLabel('Description')
    .fill('The principal amount on the FDR is ₹2,00,000, not ₹20,00,000. Please explain.');
  await dialog.getByRole('button', { name: 'Raise discrepancy' }).click();
  await expect(page.getByText('Discrepancy raised').first()).toBeVisible();
  await expect(page.getByText('Discrepancy raised', { exact: true }).first()).toBeVisible();

  // The institution answers every open discrepancy and sends the record back to AICTE.
  await logout(page);
  await login(page, USERS.institution2);
  await page.goto(path);
  const stillOpen = page
    .locator('article')
    .filter({ has: page.getByText('Open', { exact: true }) });
  await expect(stillOpen.first()).toBeVisible();
  for (let guard = 0; guard < 5 && (await stillOpen.count()) > 0; guard++) {
    const before = await stillOpen.count();
    const item = stillOpen.first();
    await item
      .getByRole('textbox', { name: 'Reply' })
      .fill('The FDR was split; the second receipt for ₹18,00,000 is uploaded.');
    await item.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(stillOpen).toHaveCount(before - 1);
  }
  await page.getByRole('button', { name: 'Send response to AICTE' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send response to AICTE' }).click();
  await expect(page.getByText('Response sent').first()).toBeVisible();
  await expect(page.getByText('Under scrutiny').first()).toBeVisible();
});
