import { expect, test, type Page } from '@playwright/test'

const password = 'e2e-password-1'

async function signUp(page: Page) {
  const email = `progress-${Date.now()}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Display name').fill('Progress reader')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/thread$/)
}

// The fake provider's correct choice for item n (1-based) is index (n * 3) % 4: 3, 2, 1, 0, 3.
const CORRECT = [3, 2, 1, 0, 3]

test('progress shows what was studied, starts a topic quiz, and saves the profile', async ({
  page
}) => {
  await signUp(page)

  // Ask one question in a React thread.
  await page.getByRole('link', { name: 'New thread' }).first().click()
  await page.getByLabel('Topic').selectOption({ label: 'React' })
  await page.getByRole('textbox', { name: 'Your question' }).fill('Why does my effect run twice?')
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect(page).toHaveURL(/\/thread\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'Why it happens' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0)
  const threadUrl = page.url()

  // A guide with one step done.
  await page.getByRole('button', { name: 'Guide me step by step' }).click()
  await expect(page).toHaveURL(/\/guide\/[^/]+$/)
  await page.getByRole('button', { name: 'Mark done' }).click()
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')

  // A quiz, answered perfectly.
  await page.goto(threadUrl)
  await page.getByRole('button', { name: 'Quiz me', exact: true }).click()
  await expect(page).toHaveURL(/\/quiz\/[^/]+$/)
  const items = page.getByRole('group').filter({ has: page.getByRole('radio') })
  for (const [i, correct] of CORRECT.entries()) {
    await items.nth(i).getByRole('radio').nth(correct).check()
  }
  await page.getByRole('button', { name: 'Submit answers' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('5 of 5 correct')

  // The progress page adds it all up.
  await page.getByRole('link', { name: 'Progress', exact: true }).click()
  await expect(page).toHaveURL(/\/progress$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible()

  const streak = page.getByRole('region', { name: 'Streak' })
  await expect(streak).toContainText('1 day streak')
  await expect(streak).toContainText('You studied today.')
  await expect(page.getByText(/^1 question asked, 1 step done, 0 guides completed/)).toBeVisible()

  const react = page.getByRole('row', { name: /^React/ })
  await expect(react.getByRole('cell').nth(0)).toHaveText(/1$/, { useInnerText: true })
  await expect(react.getByRole('cell').nth(1)).toHaveText(/1$/, { useInnerText: true })
  await expect(react.getByRole('cell').nth(3)).toHaveText(/1$/, { useInnerText: true })
  await expect(react.getByRole('cell').nth(4)).toHaveText(/100%$/, { useInnerText: true })
  await expect(react.getByRole('cell').nth(5)).toHaveText(/100%$/, { useInnerText: true })
  await expect(page.getByRole('rowgroup', { name: 'Not started yet' })).toBeVisible()

  const recent = page.getByRole('region', { name: 'Recent activity' })
  await expect(recent.getByRole('link')).toHaveCount(3)

  // A quiz on a topic that has no thread yet.
  await page.getByRole('button', { name: 'Quiz me on SQL' }).click()
  await expect(page).toHaveURL(/\/quiz\/[^/]+$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Medium quiz on SQL' })).toBeVisible()

  // Rename yourself: the shell follows.
  await page.goto('/progress')
  await page.getByLabel('Display name').fill('Ada Lovelace')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible()
  await expect(page.getByRole('complementary').getByText('Ada Lovelace')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeDisabled()
})

test('a time zone the server rejects shows its message beside the field', async ({ page }) => {
  await signUp(page)
  await page.goto('/progress')

  const zone = page.getByLabel('Time zone')
  await zone.waitFor()
  // The picker only offers valid zones, so force a bad one to see the server's answer.
  await zone.evaluate((el: HTMLSelectElement) => {
    const option = new Option('Nowhere/Land', 'Nowhere/Land')
    el.append(option)
  })
  await zone.selectOption('Nowhere/Land')
  await page.getByRole('button', { name: 'Save profile' }).click()

  await expect(page.locator('#time-zone-hint ~ p')).toBeVisible()
  await expect(page.getByText('Profile saved')).toHaveCount(0)
})

test('the topic table keeps its table semantics on a phone-sized screen', async ({ page }) => {
  await signUp(page)
  await page.getByRole('link', { name: 'New thread' }).first().click()
  await page.getByLabel('Topic').selectOption({ label: 'React' })
  await page.getByRole('textbox', { name: 'Your question' }).fill('Why does my effect run twice?')
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect(page.getByRole('heading', { name: 'Why it happens' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/progress')

  const table = page.getByRole('table', { name: 'Topics' })
  await expect(table).toBeVisible()
  const row = table.getByRole('row', { name: /^React/ })
  await expect(row).toBeVisible()
  await expect(row.getByRole('rowheader', { name: 'React' })).toBeVisible()
  // Each stacked cell carries its own label, so it reads "Questions 0" without the header row.
  await expect(row.getByRole('cell', { name: /^Questions\s*1$/ })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Quiz me on React' })).toBeVisible()
  // Topics without activity stay a labelled group, with a name and a quiz button per row.
  const group = table.getByRole('rowgroup', { name: 'Not started yet' })
  await expect(group.getByRole('rowheader', { name: 'SQL' })).toBeVisible()
  await expect(group.getByRole('cell', { name: /^Questions/ })).toHaveCount(0)
})
