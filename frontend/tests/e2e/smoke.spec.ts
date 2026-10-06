import { expect, test } from '@playwright/test'

test('home page shows the product name', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { level: 1, name: 'AI Tutor for Developers' })
  ).toBeVisible()
})
