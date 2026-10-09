import { expect, test, type Page } from '@playwright/test'

const password = 'e2e-password-1'

async function logIn(page: Page, email: string, pass: string) {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(pass)
  await page.getByRole('button', { name: 'Log in' }).click()
}

/**
 * Signs out the way an expired cookie would, from outside the app: a page still loading answers a
 * lost session with its own full-page redirect to /login, which would abort the next `goto`.
 */
async function dropSession(page: Page) {
  await page.goto('about:blank')
  await page.context().clearCookies()
}

test('/ sends a signed-out visitor to /login', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible()
})

test('visiting a protected page signed out redirects to /login with next', async ({ page }) => {
  await page.goto('/thread')
  await expect(page).toHaveURL(/\/login\?next=%2Fthread$/)
})

test('sign up, log out, log in again', async ({ page }) => {
  const email = `ada-${Date.now()}@example.com`

  await page.goto('/signup')
  await page.getByLabel('Display name').fill('Ada Lovelace')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/thread$/)
  const nav = page.getByRole('complementary')
  await expect(nav.getByText('Ada Lovelace')).toBeVisible()
  await expect(page.getByText('No threads yet. Ask your first question.')).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Threads' })).toHaveAttribute('aria-current', 'page')

  await nav.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText('Logged out')).toBeVisible()

  // The session is gone for real: the app is closed again.
  await page.goto('/progress')
  await expect(page).toHaveURL(/\/login\?next=%2Fprogress$/)

  await logIn(page, email, password)
  await expect(page).toHaveURL(/\/progress$/)
  await expect(page.getByRole('complementary').getByText('Ada Lovelace')).toBeVisible()
})

test('a signed-in visitor on /login is sent to /thread', async ({ page }) => {
  const email = `grace-${Date.now()}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Display name').fill('Grace')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/thread$/)

  await page.goto('/login')
  await expect(page).toHaveURL(/\/thread$/)
})

test('a wrong password shows the inline error and stays on /login', async ({ page }) => {
  const email = `alan-${Date.now()}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Display name').fill('Alan')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/thread$/)
  await page.getByRole('complementary').getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login$/)

  await logIn(page, email, 'not-the-password')

  await expect(page.locator('form').getByRole('alert')).toHaveText(
    'Email or password is incorrect.'
  )
  await expect(page).toHaveURL(/\/login$/)
})

test('signing up with a taken email shows the inline error', async ({ page }) => {
  const email = `taken-${Date.now()}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Display name').fill('Demo')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/thread$/)
  await dropSession(page)

  await page.goto('/signup')
  await page.getByLabel('Display name').fill('Other')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByLabel('Email')).toHaveAccessibleDescription(/already exists/)
})
