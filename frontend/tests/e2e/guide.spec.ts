import { expect, test, type Page } from '@playwright/test'

const password = 'e2e-password-1'
let counter = 0

async function signUp(page: Page) {
  const email = `guide-${Date.now()}-${counter++}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Display name').fill('Guide reader')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/thread$/)
}

async function newThread(page: Page, question: string) {
  await page.getByRole('link', { name: 'New thread' }).first().click()
  await page.getByLabel('Topic').selectOption({ label: 'React' })
  await page.getByRole('textbox', { name: 'Your question' }).fill(question)
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect(page).toHaveURL(/\/thread\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'Why it happens' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0)
}

const generate = (page: Page) => page.getByRole('button', { name: 'Guide me step by step' })
const toasts = (page: Page) => page.locator('[data-sonner-toast]')
const steps = (page: Page) => page.getByRole('navigation', { name: 'Steps' }).getByRole('listitem')

async function totalSteps(page: Page) {
  const text = await page.getByText(/^Step \d+ of \d+$/).textContent()
  return Number(/of (\d+)/.exec(text ?? '')?.[1])
}

test('turn an answer into a guide, work through it, and finish', async ({ page }) => {
  await signUp(page)
  await newThread(page, 'Why does my effect run twice?')

  await generate(page).click()
  await expect(page).toHaveURL(/\/guide\/[^/]+$/)
  await expect(page.getByText(/^Step 1 of \d+$/)).toBeVisible()
  const total = await totalSteps(page)
  expect(total).toBeGreaterThanOrEqual(3)
  expect(total).toBeLessThanOrEqual(8)
  await expect(steps(page)).toHaveCount(total)
  const progress = page.getByRole('progressbar')
  await expect(progress).toHaveAttribute('aria-valuenow', '0')
  await expect(progress).toHaveAttribute('aria-valuemax', String(total))

  // The hint stays hidden until asked for, and stays shown after a reload.
  await expect(page.getByRole('complementary', { name: 'Hint' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Show hint' }).click()
  await expect(page.getByRole('complementary', { name: 'Hint' })).toBeVisible()

  await page.getByRole('button', { name: 'Mark done' }).click()
  await expect(page.getByText(`Step 2 of ${total}`)).toBeVisible()
  await expect(progress).toHaveAttribute('aria-valuenow', '1')

  await page.reload()
  // The first step that is not done comes up first, so go back to step 1.
  await expect(page.getByText(`Step 2 of ${total}`)).toBeVisible()
  await expect(progress).toHaveAttribute('aria-valuenow', '1')
  await page
    .getByRole('navigation', { name: 'Steps' })
    .getByRole('button', { name: /Step 1/ })
    .click()
  await expect(page.getByText(`Step 1 of ${total}`)).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Hint' })).toBeVisible()
  await expect(page.getByText('Done', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Mark not done' }).click()
  await expect(page.getByRole('button', { name: 'Mark done' })).toBeVisible()
  await expect(progress).toHaveAttribute('aria-valuenow', '0')

  await page.reload()
  await expect(page.getByText(`Step 1 of ${total}`)).toBeVisible()
  await expect(progress).toHaveAttribute('aria-valuenow', '0')
  await expect(page.getByRole('complementary', { name: 'Hint' })).toBeVisible()

  for (let i = 1; i <= total; i++) {
    await expect(page.getByText(`Step ${i} of ${total}`)).toBeVisible()
    await page.getByRole('button', { name: 'Mark done' }).click()
  }

  await expect(page.getByRole('heading', { name: 'Guide complete.' })).toBeVisible()
  await expect(page.getByText('Test yourself to see what stuck.')).toBeVisible()
  await expect(progress).toHaveAttribute('aria-valuenow', String(total))

  // The conversation links the guide with its progress, and the guide links back.
  await page.getByRole('link', { name: 'Back to the conversation' }).last().click()
  await expect(page).toHaveURL(/\/thread\/[^/]+$/)
  await expect(
    page.getByRole('link', { name: new RegExp(`Open guide: .*\\(${total} of ${total} done\\)`) })
  ).toBeVisible()
})

test('Guide me step by step is unavailable until the thread has an answer', async ({ page }) => {
  await signUp(page)
  await page.getByRole('link', { name: 'New thread' }).first().click()
  await page.getByLabel('Topic').selectOption({ label: 'React' })
  // A refused question leaves the thread without a complete answer.
  await page.getByRole('textbox', { name: 'Your question' }).fill('[fake:refuse] Do something odd')
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect(page).toHaveURL(/\/thread\/[^/]+$/)

  await expect(generate(page)).toBeDisabled()
  await expect(page.getByText('Ask a question first')).toBeVisible()
})

test('a guide the provider cannot produce shows a toast with Retry', async ({ page }) => {
  await signUp(page)
  await newThread(page, '[fake:guide-invalid] Why does my effect run twice?')

  await generate(page).click()

  const toast = toasts(page).filter({ hasText: 'The tutor produced something unusable.' })
  await expect(toast).toBeVisible()
  await expect(toast.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(page).toHaveURL(/\/thread\/[^/]+$/)
  await expect(generate(page)).toBeEnabled()
})

test('a guide the tutor refuses explains itself without Retry', async ({ page }) => {
  await signUp(page)
  await newThread(page, '[fake:guide-refuse] Why does my effect run twice?')

  await generate(page).click()

  const toast = toasts(page).filter({ hasText: "The tutor can't help with that question." })
  await expect(toast).toBeVisible()
  await expect(toast.getByRole('button', { name: 'Retry' })).toHaveCount(0)
})

test('a guide that does not exist says so', async ({ page }) => {
  await signUp(page)
  await page.goto('/guide/00000000-0000-7000-8000-000000000000')

  await expect(page.getByText("This guide doesn't exist or was deleted.")).toBeVisible()
  await page.getByRole('link', { name: 'Back to threads' }).click()
  await expect(page).toHaveURL(/\/thread$/)
})
