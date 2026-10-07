import { expect, test, type Locator, type Page } from '@playwright/test'
import pg from 'pg'
import { E2E_BACKEND_ENV } from './e2e-env'

// QA adversarial pass for plan 001: deep links, inert markdown, keyboard-only flow, budget banner.

const password = 'e2e-password-1'
let counter = 0

/**
 * Runs one parameterised statement against the isolated `ai_tutor_e2e` database. It connects over
 * the network, like the backend does, so it works against compose locally and the CI service container.
 */
async function sql(text: string, values: unknown[] = []): Promise<void> {
  const client = new pg.Client({ connectionString: E2E_BACKEND_ENV.DATABASE_URL })
  await client.connect()
  try {
    await client.query(text, values)
  } finally {
    await client.end()
  }
}

/** Records more AI usage today than the e2e daily budget (50000 tokens) allows. */
function spendDailyBudget(email: string): Promise<void> {
  return sql(
    `INSERT INTO ai_call (user_id, kind, model, input_token, output_token, cache_read_token,
       stop_reason, latency_ms)
     SELECT id, 'explain', 'fake', 40000, 20000, 0, 'end_turn', 1
     FROM app_user WHERE email = $1`,
    [email]
  )
}

async function signUp(page: Page, name = 'QA user') {
  const email = `qa-${Date.now()}-${counter++}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Display name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/thread$/)
  return email
}

async function ask(page: Page, question: string) {
  await page.getByRole('link', { name: 'New thread' }).first().click()
  await page.getByLabel('Topic').selectOption({ label: 'React' })
  await page.getByRole('textbox', { name: 'Your question' }).fill(question)
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect(page).toHaveURL(/\/thread\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'Why it happens' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0)
}

/** Presses Tab until `target` holds focus. Fails the test if it is never reached. */
async function tabTo(page: Page, target: Locator, limit = 60) {
  for (let i = 0; i < limit; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('keyboard focus never reached the target within the Tab limit')
}

test('an unauthenticated deep link to a guide goes to login and comes back after login', async ({
  page
}) => {
  const email = await signUp(page)
  await ask(page, 'Why does my effect run twice?')
  await page.getByRole('button', { name: 'Guide me step by step' }).click()
  await expect(page).toHaveURL(/\/guide\/[^/]+$/)
  const guideUrl = page.url()
  const guidePath = new URL(guideUrl).pathname

  await page.context().clearCookies()
  await page.goto(guideUrl)
  await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(guidePath)}$`))
  await expect(page.getByText(/^Step \d+ of \d+$/)).toHaveCount(0)

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(guideUrl)
  await expect(page.getByText(/^Step \d+ of \d+$/)).toBeVisible()
})

test('a signed-out deep link to a quiz and a thread keeps its path through login', async ({
  page
}) => {
  await page.goto('/quiz/00000000-0000-7000-8000-000000000000')
  await expect(page).toHaveURL(/\/login\?next=%2Fquiz%2F00000000-0000-7000-8000-000000000000$/)
  await page.goto('/thread/00000000-0000-7000-8000-000000000000')
  await expect(page).toHaveURL(/\/login\?next=%2Fthread%2F00000000-0000-7000-8000-000000000000$/)
})

test('login ignores an off-site next parameter', async ({ page }) => {
  const email = await signUp(page)
  await page.context().clearCookies()
  for (const next of ['https://evil.example/', '//evil.example/', '/\\evil.example']) {
    await page.goto(`/login?next=${encodeURIComponent(next)}`)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page).toHaveURL(/localhost:3100\/(thread|progress)/)
    expect(new URL(page.url()).hostname).toBe('localhost')
    await page.context().clearCookies()
  }
})

test('markdown with script, onerror and javascript: links renders inert', async ({ page }) => {
  const dialogs: string[] = []
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message())
    await dialog.dismiss()
  })
  const email = await signUp(page)
  await ask(page, 'Why does my effect run twice?')

  const payload = [
    'Safe lead sentence.',
    '',
    '<script>window.__pwned = 1</script>',
    '',
    '<img src=x onerror="window.__pwned = 2">',
    '',
    '[click me](javascript:window.__pwned=3)',
    '',
    '[encoded](&#106;avascript:window.__pwned=5)',
    '',
    '[data uri](data:text/html,<script>window.__pwned=6</script>)',
    '',
    '<a href="javascript:window.__pwned=4" onclick="window.__pwned=7">raw anchor</a>',
    '',
    '<iframe src="javascript:window.__pwned=8"></iframe>',
    '',
    '![pixel](javascript:window.__pwned=9)',
    '',
    '<svg onload="window.__pwned=10"></svg>'
  ].join('\n')
  await sql(
    `UPDATE message SET content = $1
     WHERE role = 'assistant' AND user_id = (SELECT id FROM app_user WHERE email = $2)`,
    [payload, email]
  )
  await page.reload()
  await expect(page.getByText('Safe lead sentence.')).toBeVisible()
  await page.waitForLoadState('networkidle')

  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
    undefined
  )
  await expect(page.locator('img[onerror]')).toHaveCount(0)
  await expect(page.locator('[onclick], [onload], [onerror]')).toHaveCount(0)
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.locator('main svg[onload]')).toHaveCount(0)
  for (const href of await page
    .locator('a[href]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''))) {
    expect(href.trim().toLowerCase()).not.toMatch(/^(javascript|data|vbscript):/)
  }
  // Click whatever stands for the javascript: link; it must do nothing.
  const link = page.getByText('click me')
  if (await link.count()) await link.first().click()
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
    undefined
  )
  expect(dialogs).toEqual([])
})

test('a user message holding HTML is shown as text, not parsed', async ({ page }) => {
  const dialogs: string[] = []
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message())
    await dialog.dismiss()
  })
  await signUp(page)
  await ask(page, '<img src=x onerror="window.__pwned=1"> and <script>window.__pwned=2</script>')
  await expect(page.locator('img[onerror]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
    undefined
  )
  expect(dialogs).toEqual([])
})

test('keyboard only: ask a question, build a guide, mark the first step done', async ({ page }) => {
  await signUp(page)
  await page.getByRole('link', { name: 'New thread' }).first().click()
  const box = page.getByRole('textbox', { name: 'Your question' })
  await box.focus()
  await page.keyboard.type('Why does my effect run twice?')
  await tabTo(page, page.getByRole('button', { name: 'Ask' }))
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/thread\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'Why it happens' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0)

  await tabTo(page, page.getByRole('button', { name: 'Guide me step by step' }))
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/guide\/[^/]+$/)
  await expect(page.getByText(/^Step 1 of \d+$/)).toBeVisible()

  await tabTo(page, page.getByRole('button', { name: 'Show hint' }))
  await page.keyboard.press('Space')
  await expect(page.getByRole('complementary', { name: 'Hint' })).toBeVisible()

  await tabTo(page, page.getByRole('button', { name: 'Mark done' }))
  await page.keyboard.press('Enter')
  await expect(page.getByText(/^Step 2 of \d+$/)).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
})

test('a spent daily budget shows the banner, locks the composer and keeps the error toast', async ({
  page
}) => {
  const email = await signUp(page)
  await spendDailyBudget(email)

  await page.getByRole('link', { name: 'New thread' }).first().click()
  await page.getByLabel('Topic').selectOption({ label: 'React' })
  await page.getByRole('textbox', { name: 'Your question' }).fill('Will this go through?')
  await page.getByRole('button', { name: 'Ask' }).click()

  await expect(page.getByText("You've used today's AI budget.").first()).toBeVisible()
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: "You've used today's AI budget" })
  ).toBeVisible()
  // No assistant answer was invented and nothing says it succeeded.
  await expect(page.getByRole('heading', { name: 'Why it happens' })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Your question' })).toBeDisabled()
})

test('a spent budget also blocks guide generation with a toast, not a crash', async ({ page }) => {
  const email = await signUp(page)
  await ask(page, 'Why does my effect run twice?')
  await spendDailyBudget(email)
  await page.getByRole('button', { name: 'Guide me step by step' }).click()
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: "You've used today's AI budget" })
  ).toBeVisible()
  await expect(page).toHaveURL(/\/thread\/[^/]+$/)
  await expect(page.getByRole('button', { name: 'Guide me step by step' })).toBeEnabled()
})
