import { expect, test, type Page } from '@playwright/test'

const password = 'e2e-password-1'

async function signUp(page: Page) {
  await page.goto('/signup')
  await page.getByLabel('Display name').fill('Sec')
  await page.getByLabel('Email').fill(`sec-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/thread$/)
}

test('pages carry a nonce-based CSP and the other security headers', async ({ page }) => {
  const response = await page.goto('/login')
  const headers = response!.headers()
  expect(headers['content-security-policy']).toMatch(
    /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/
  )
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(headers['content-security-policy']).toContain('connect-src')
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
})

test('the nonce changes on every request', async ({ page }) => {
  const nonce = async () =>
    /'nonce-([^']+)'/.exec(
      (await page.goto('/login'))!.headers()['content-security-policy'] ?? ''
    )?.[1]
  const first = await nonce()
  expect(first).toBeTruthy()
  expect(await nonce()).not.toBe(first)
})

test('the conversation page, with a highlighted code block, raises no CSP violation', async ({
  page
}) => {
  const problems: string[] = []
  page.on('console', (message) => {
    if (/content security policy|refused to/i.test(message.text())) {
      problems.push(message.text())
    }
  })
  page.on('pageerror', (error) => problems.push(error.message))

  await signUp(page)
  await page.getByRole('link', { name: 'New thread' }).first().click()
  await page.getByLabel('Topic').selectOption({ label: 'React' })
  await page.getByRole('textbox', { name: 'Your question' }).fill('Why does my effect run twice?')
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect(page).toHaveURL(/\/thread\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'Why it happens' })).toBeVisible()
  await expect(page.locator('figure pre.shiki span').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0)

  expect(problems).toEqual([])
})
