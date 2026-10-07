import { expect, test, type Page } from '@playwright/test'

const password = 'e2e-password-1'
let counter = 0

async function signUp(page: Page) {
  const email = `quiz-${Date.now()}-${counter++}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Display name').fill('Quiz taker')
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

const quizMe = (page: Page) => page.getByRole('button', { name: 'Quiz me', exact: true })
const toasts = (page: Page) => page.locator('[data-sonner-toast]')
const submit = (page: Page) => page.getByRole('button', { name: 'Submit answers' })
const items = (page: Page) => page.getByRole('group').filter({ has: page.getByRole('radio') })

// The fake provider's correct choice for item n (1-based) is index (n * 3) % 4: 3, 2, 1, 0, 3.
const CORRECT = [3, 2, 1, 0, 3]

/** Picks `pick(correctIndex, itemNumber)` for each of the five items. */
async function answerAll(page: Page, pick: (correct: number, n: number) => number) {
  for (const [i, correct] of CORRECT.entries()) {
    await items(page)
      .nth(i)
      .getByRole('radio')
      .nth(pick(correct, i + 1))
      .check()
  }
}

test('quiz me, answer, review, reload the review, retake', async ({ page }) => {
  await signUp(page)
  await newThread(page, 'Why does my effect run twice?')

  await page.getByLabel('Quiz difficulty').selectOption('Hard')
  await quizMe(page).click()
  await expect(page).toHaveURL(/\/quiz\/[^/]+$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Hard quiz on React' })).toBeVisible()

  // Five numbered items on one sheet, four choices each.
  await expect(items(page)).toHaveCount(5)
  for (let i = 0; i < 5; i++) {
    await expect(items(page).nth(i).getByRole('radio')).toHaveCount(4)
  }
  await expect(page.getByRole('listitem').filter({ has: items(page) })).toHaveCount(5)
  await expect(page.getByText('0 of 5 answered')).toBeVisible()
  await expect(submit(page)).toBeDisabled()

  // One short of done keeps Submit disabled; the fifth enables it.
  await items(page).nth(0).getByRole('radio').nth(3).check()
  await items(page).nth(1).getByRole('radio').nth(2).check()
  await items(page).nth(2).getByRole('radio').nth(1).check()
  await items(page).nth(3).getByRole('radio').nth(1).check()
  await expect(page.getByText('4 of 5 answered')).toBeVisible()
  await expect(submit(page)).toBeDisabled()
  await items(page).nth(4).getByRole('radio').nth(0).check()
  await expect(page.getByText('5 of 5 answered')).toBeVisible()
  await expect(submit(page)).toBeEnabled()
  const quizUrl = page.url()

  // Items 4 and 5 are wrong: 3 of 5.
  await submit(page).click()
  await expect(page).toHaveURL(/\/quiz\/[^/]+\/attempt\/[^/]+$/)
  const score = page.getByRole('heading', { level: 1 })
  await expect(score).toHaveText('3 of 5 correct')
  await expect(score).toBeFocused()

  const review = async () => {
    await expect(page.getByText(/^Correct$/)).toHaveCount(3)
    await expect(page.getByText(/^Incorrect$/)).toHaveCount(2)
    await expect(page.getByText('Explanation')).toHaveCount(5)
    await expect(page.getByText(/is right because it follows the React rule/)).toHaveCount(5)
    await expect(page.getByText('Correct answer')).toHaveCount(5)
    // A wrong pick is named as the learner's own answer and struck through.
    const wrongItem = page.getByRole('list', { name: 'Choices' }).nth(3)
    await expect(wrongItem.getByText('Your answer')).toHaveCount(1)
    await expect(wrongItem.getByText('A common React misconception 2 for item 4')).toHaveCSS(
      'text-decoration-line',
      'line-through'
    )
    await expect(wrongItem.getByText('The hard React rule for item 4')).not.toHaveCSS(
      'text-decoration-line',
      'line-through'
    )
  }
  await review()

  await page.reload()
  await expect(score).toHaveText('3 of 5 correct')
  await review()

  // Retake: a fresh form, and the quiz now lists the attempt.
  await page.getByRole('link', { name: 'Retake quiz' }).click()
  await expect(page).toHaveURL(quizUrl)
  await expect(page.getByText('0 of 5 answered')).toBeVisible()
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /^Attempt on .+: 3 of 5$/ })).toHaveCount(1)

  await answerAll(page, (correct) => correct)
  await submit(page).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('5 of 5 correct')

  await page.getByRole('link', { name: 'Retake quiz' }).click()
  await expect(page.getByRole('link', { name: /^Attempt on / })).toHaveCount(2)
  await expect(page.getByRole('link', { name: /^Attempt on .+: 5 of 5$/ })).toBeVisible()

  // The conversation lists the quiz with its best score.
  await page.getByRole('link', { name: 'Back to the conversation' }).click()
  await expect(page).toHaveURL(/\/thread\/[^/]+$/)
  await expect(page.getByRole('link', { name: 'Hard quiz, best 5 of 5' })).toBeVisible()
})

test('Quiz me is unavailable until the thread has an answer', async ({ page }) => {
  await signUp(page)
  await page.getByRole('link', { name: 'New thread' }).first().click()
  await page.getByLabel('Topic').selectOption({ label: 'React' })
  // A refused question leaves the thread without a complete answer.
  await page.getByRole('textbox', { name: 'Your question' }).fill('[fake:refuse] Do something odd')
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect(page).toHaveURL(/\/thread\/[^/]+$/)

  await expect(quizMe(page)).toBeDisabled()
  await expect(page.getByText('Ask a question first')).toBeVisible()
})

test('a quiz the provider cannot produce shows a toast with Retry', async ({ page }) => {
  await signUp(page)
  await newThread(page, '[fake:quiz-invalid] Why does my effect run twice?')

  await quizMe(page).click()

  const toast = toasts(page).filter({ hasText: 'The tutor produced something unusable.' })
  await expect(toast).toBeVisible()
  await expect(toast.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(page).toHaveURL(/\/thread\/[^/]+$/)
  await expect(quizMe(page)).toBeEnabled()
})

test('a quiz the tutor refuses explains itself without Retry', async ({ page }) => {
  await signUp(page)
  await newThread(page, '[fake:quiz-refuse] Why does my effect run twice?')

  await quizMe(page).click()

  const toast = toasts(page).filter({ hasText: "The tutor can't help with that question." })
  await expect(toast).toBeVisible()
  await expect(toast.getByRole('button', { name: 'Retry' })).toHaveCount(0)
})

test('a quiz or review that does not exist says so', async ({ page }) => {
  await signUp(page)
  await page.goto('/quiz/00000000-0000-7000-8000-000000000000')

  await expect(page.getByText("This quiz doesn't exist or was deleted.")).toBeVisible()
  await page.getByRole('link', { name: 'Back to threads' }).click()
  await expect(page).toHaveURL(/\/thread$/)
})
