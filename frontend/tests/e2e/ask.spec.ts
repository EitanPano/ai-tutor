import { expect, test, type Page } from '@playwright/test'

const password = 'e2e-password-1'
let counter = 0

async function signUp(page: Page) {
  const email = `asker-${Date.now()}-${counter++}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Display name').fill('Asker')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/thread$/)
}

async function newThread(page: Page, topic: string, question: string) {
  await page.getByRole('link', { name: 'New thread' }).first().click()
  await page.getByLabel('Topic').selectOption({ label: topic })
  await box(page).fill(question)
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect(page).toHaveURL(/\/thread\/[^/]+$/)
}

const answers = (page: Page) => page.getByRole('article', { name: 'Tutor answer' })
const questions = (page: Page) => page.getByRole('article', { name: 'Your question' })
const box = (page: Page) => page.getByRole('textbox', { name: 'Your question' })
const toasts = (page: Page) => page.locator('[data-sonner-toast]')

test('ask streams an answer that survives a reload, then a follow-up', async ({ page }) => {
  await signUp(page)
  await expect(page.getByText('No threads yet. Ask your first question.')).toBeVisible()

  await newThread(page, 'React', 'Why does my effect run twice?')

  await expect(questions(page)).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Why it happens' })).toBeVisible()
  const code = page.locator('figure')
  await expect(code).toContainText('tsx')
  await expect(code.getByRole('button', { name: 'Copy' })).toBeVisible()
  // Highlighting arrives once the answer is done.
  await expect(code.locator('pre.shiki span').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Answer ready' })).toBeAttached()

  // The thread is titled from the first question and listed.
  const list = page.getByRole('complementary', { name: 'Your threads' })
  await expect(list.getByRole('link', { name: /Why does my effect run twice/ })).toBeVisible()
  await expect(list.getByText('React')).toBeVisible()

  await page.reload()
  await expect(questions(page)).toHaveCount(1)
  await expect(questions(page).first()).toContainText('Why does my effect run twice?')
  await expect(page.getByRole('heading', { name: 'Why it happens' })).toBeVisible()

  await box(page).fill('And what about cleanup?')
  await box(page).press('Control+Enter')
  await expect(questions(page)).toHaveCount(2)
  await expect(answers(page)).toHaveCount(2)
  await expect(page.getByRole('heading', { name: 'Why it happens' })).toHaveCount(2)
  await expect(box(page)).toHaveValue('')
})

test('a slow answer is visible while it streams and Stop keeps the partial text', async ({
  page
}) => {
  await signUp(page)
  await newThread(page, 'Other', '[fake:slow] Explain closures')

  const stop = page.getByRole('button', { name: 'Stop' })
  await expect(stop).toBeVisible()
  await expect(answers(page).first()).toContainText('Here is a walkthrough')
  // Delivery is incremental: the answer is partial and still streaming.
  await expect(answers(page).first()).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByRole('heading', { name: 'Why it happens' })).toHaveCount(0)
  await expect(stop).toBeVisible()

  await stop.click()

  await expect(page.getByText('Stopped before the answer finished.')).toBeVisible()
  await expect(answers(page).first()).toContainText('Here is a walkthrough')
  await expect(box(page)).toBeEnabled()
})

test('a provider error shows a toast with Retry and a failed turn', async ({ page }) => {
  await signUp(page)
  await newThread(page, 'Other', '[fake:error] Explain closures')

  const toast = toasts(page).filter({ hasText: 'The AI service failed to answer.' })
  await expect(toast).toBeVisible()
  await expect(toast.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(page.getByText('This answer failed.')).toBeVisible()
  await expect(questions(page)).toHaveCount(1)
  await expect(box(page)).toBeEnabled()
})

test('a refused question explains itself', async ({ page }) => {
  await signUp(page)
  await newThread(page, 'Other', '[fake:refuse] Do something odd')

  await expect(
    page.getByText("The tutor can't help with that question. Try rephrasing it.").first()
  ).toBeVisible()
})

test('an answer cut off at the length limit says so', async ({ page }) => {
  await signUp(page)
  await newThread(page, 'Other', '[fake:max_tokens] Explain closures')

  await expect(
    page.getByText('This answer was cut off at the length limit. Ask a follow-up to continue.')
  ).toBeVisible()
})

test('rename, change topic and delete a thread', async ({ page }) => {
  await signUp(page)
  await newThread(page, 'React', 'Explain hooks')
  await expect(page.getByRole('heading', { name: 'Why it happens' })).toBeVisible()
  const list = page.getByRole('complementary', { name: 'Your threads' })

  await page.getByRole('button', { name: /Rename thread/ }).click()
  const title = page.getByLabel('Thread title')
  await title.fill('Hooks, explained')
  await title.press('Enter')
  await expect(page.getByRole('button', { name: 'Rename thread: Hooks, explained' })).toBeVisible()
  await expect(list.getByRole('link', { name: /Hooks, explained/ })).toBeVisible()

  // Escape leaves the title alone.
  await page.getByRole('button', { name: /Rename thread/ }).click()
  await page.getByLabel('Thread title').fill('Never saved')
  await page.getByLabel('Thread title').press('Escape')
  await expect(page.getByRole('button', { name: 'Rename thread: Hooks, explained' })).toBeVisible()

  await page.getByLabel('Topic').selectOption({ label: 'Python' })
  await expect(list.getByText('Python')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Topic')).toHaveValue('python')

  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Delete this thread?')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Delete this thread?')).toHaveCount(0)

  await page.getByRole('button', { name: 'Delete' }).click()
  await page
    .getByRole('group', { name: 'Confirm delete' })
    .getByRole('button', { name: 'Delete' })
    .click()

  await expect(page).toHaveURL(/\/thread$/)
  await expect(toasts(page).filter({ hasText: 'Thread deleted' })).toBeVisible()
  await expect(page.getByText('No threads yet. Ask your first question.')).toBeVisible()
})

test('a thread that does not exist says so', async ({ page }) => {
  await signUp(page)
  await page.goto('/thread/00000000-0000-7000-8000-000000000000')

  await expect(page.getByText("This thread doesn't exist or was deleted.")).toBeVisible()
})
