import { sql } from 'kysely'
import type { Db } from '../../lib/db/index.js'
import { isQuizLive, isThreadLive, ownedBy, requireFound, type Auth } from '../../lib/ownership.js'
import { DAY_MS } from '../../lib/time.js'

export type TopicProgressDto = {
  topicId: string
  topicName: string
  questions: number
  guidesCompleted: number
  stepsDone: number
  attempts: number
  bestScorePercent: number | null
  averageScorePercent: number | null
  lastActivityAt: string | null
}

export type StreakDto = { current: number; longest: number; isActiveToday: boolean }

export type ActivityDto = {
  kind: 'question' | 'step' | 'attempt'
  at: string
  topicId: string
  title: string
  threadId: string | null
  guideId: string | null
  quizId: string | null
}

export type ProgressDto = {
  totals: { questions: number; guidesCompleted: number; stepsDone: number; attempts: number }
  streak: StreakDto
  topics: TopicProgressDto[]
  recent: ActivityDto[]
}

const RECENT_LIMIT = 10

type ProgressServiceDeps = { db: Db }

export type ProgressService = {
  /**
   * Per-topic progress, totals, streak and recent activity, all from SQL aggregates.
   *
   * Content derived from a soft-deleted thread (its questions, guides, steps and thread-based
   * quizzes and attempts) is excluded; topic-only quizzes always count. `now` is explicit so
   * "today" is computed in the user's time zone from it, never from the database clock.
   */
  get(auth: Auth, options?: { now?: Date }): Promise<ProgressDto>
}

export function createProgressService({ db }: ProgressServiceDeps): ProgressService {
  return {
    async get(auth, { now = new Date() } = {}) {
      const nowIso = now.toISOString()
      const user = requireFound(
        await sql<{ time_zone: string; today: string }>`
          SELECT time_zone, (${nowIso}::timestamptz AT TIME ZONE time_zone)::date::text AS today
          FROM app_user WHERE id = ${auth.userId}`
          .execute(db)
          .then((result) => result.rows[0])
      )
      const [topicRows, dayRows, recentRows] = await Promise.all([
        topicRowsQuery(db, auth),
        activeDayRowsQuery(db, auth, user.time_zone),
        recentRowsQuery(db, auth)
      ])

      const topics = topicRows.map<TopicProgressDto>((row) => ({
        topicId: row.id,
        topicName: row.name,
        questions: row.questions,
        guidesCompleted: row.guides_completed,
        stepsDone: row.steps_done,
        attempts: row.attempts,
        bestScorePercent: row.best_score_percent,
        averageScorePercent: row.average_score_percent,
        lastActivityAt: row.last_activity_at ? row.last_activity_at.toISOString() : null
      }))
      const totals = topics.reduce(
        (sum, topic) => ({
          questions: sum.questions + topic.questions,
          guidesCompleted: sum.guidesCompleted + topic.guidesCompleted,
          stepsDone: sum.stepsDone + topic.stepsDone,
          attempts: sum.attempts + topic.attempts
        }),
        { questions: 0, guidesCompleted: 0, stepsDone: 0, attempts: 0 }
      )
      return {
        totals,
        streak: computeStreak(
          dayRows.map((row) => row.day),
          user.today
        ),
        topics,
        recent: recentRows.map((row) => ({
          kind: row.kind,
          at: row.at.toISOString(),
          topicId: row.topic_id,
          title: row.title,
          threadId: row.thread_id,
          guideId: row.guide_id,
          quizId: row.quiz_id
        }))
      }
    }
  }
}

type TopicRow = {
  id: string
  name: string
  questions: number
  guides_completed: number
  steps_done: number
  attempts: number
  best_score_percent: number | null
  average_score_percent: number | null
  last_activity_at: Date | null
}

/** One aggregate per activity source grouped by topic, joined onto every topic in position order. */
async function topicRowsQuery(db: Db, auth: Auth): Promise<TopicRow[]> {
  const result = await sql<TopicRow>`
    WITH q AS (
      SELECT thread.topic_id, count(*) AS n, max(message.created_at) AS last_at
      FROM message
      JOIN thread ON thread.id = message.thread_id
      WHERE ${ownedBy('message', auth)}
        AND ${isThreadLive}
        AND message.role = 'user'
        AND message.status <> 'failed'
      GROUP BY thread.topic_id
    ), s AS (
      SELECT guide.topic_id, count(*) AS n, max(guide_step.done_at) AS last_at
      FROM guide_step
      JOIN guide ON guide.id = guide_step.guide_id
      JOIN thread ON thread.id = guide.thread_id
      WHERE ${ownedBy('guide_step', auth)}
        AND ${isThreadLive}
        AND guide_step.done_at IS NOT NULL
      GROUP BY guide.topic_id
    ), g AS (
      SELECT guide.topic_id, count(*) AS n
      FROM guide
      JOIN thread ON thread.id = guide.thread_id
      WHERE ${ownedBy('guide', auth)}
        AND ${isThreadLive}
        AND EXISTS (SELECT 1 FROM guide_step WHERE guide_step.guide_id = guide.id)
        AND NOT EXISTS (
          SELECT 1 FROM guide_step WHERE guide_step.guide_id = guide.id AND guide_step.done_at IS NULL
        )
      GROUP BY guide.topic_id
    ), per_quiz AS (
      SELECT quiz.topic_id,
        count(*) AS n,
        max(quiz_attempt.score * 100.0 / nullif(quiz_attempt.total, 0)) AS best,
        max(quiz_attempt.submitted_at) AS last_at
      FROM quiz_attempt
      JOIN quiz ON quiz.id = quiz_attempt.quiz_id
      LEFT JOIN thread ON thread.id = quiz.thread_id
      WHERE ${ownedBy('quiz_attempt', auth)}
        AND ${isQuizLive}
      GROUP BY quiz.topic_id, quiz.id
    ), a AS (
      SELECT topic_id, sum(n) AS n, max(best) AS best, avg(best) AS average, max(last_at) AS last_at
      FROM per_quiz
      GROUP BY topic_id
    )
    SELECT topic.id, topic.name,
      coalesce(q.n, 0)::int AS questions,
      coalesce(g.n, 0)::int AS guides_completed,
      coalesce(s.n, 0)::int AS steps_done,
      coalesce(a.n, 0)::int AS attempts,
      round(a.best, 1)::float8 AS best_score_percent,
      round(a.average, 1)::float8 AS average_score_percent,
      greatest(q.last_at, s.last_at, a.last_at) AS last_activity_at
    FROM topic
    LEFT JOIN q ON q.topic_id = topic.id
    LEFT JOIN s ON s.topic_id = topic.id
    LEFT JOIN g ON g.topic_id = topic.id
    LEFT JOIN a ON a.topic_id = topic.id
    ORDER BY topic.position`.execute(db)
  return result.rows
}

/** Distinct local calendar days (in the user's zone) with at least one question, step or attempt. */
async function activeDayRowsQuery(db: Db, auth: Auth, timeZone: string) {
  const result = await sql<{ day: string }>`
    SELECT DISTINCT day::text AS day FROM (
      SELECT (message.created_at AT TIME ZONE ${timeZone})::date AS day
      FROM message
      JOIN thread ON thread.id = message.thread_id
      WHERE ${ownedBy('message', auth)}
        AND ${isThreadLive}
        AND message.role = 'user'
        AND message.status <> 'failed'
      UNION ALL
      SELECT (guide_step.done_at AT TIME ZONE ${timeZone})::date
      FROM guide_step
      JOIN guide ON guide.id = guide_step.guide_id
      JOIN thread ON thread.id = guide.thread_id
      WHERE ${ownedBy('guide_step', auth)}
        AND ${isThreadLive}
        AND guide_step.done_at IS NOT NULL
      UNION ALL
      SELECT (quiz_attempt.submitted_at AT TIME ZONE ${timeZone})::date
      FROM quiz_attempt
      JOIN quiz ON quiz.id = quiz_attempt.quiz_id
      LEFT JOIN thread ON thread.id = quiz.thread_id
      WHERE ${ownedBy('quiz_attempt', auth)}
        AND ${isQuizLive}
    ) AS activity
    ORDER BY day`.execute(db)
  return result.rows
}

type RecentRow = {
  kind: ActivityDto['kind']
  at: Date
  topic_id: string
  title: string
  thread_id: string | null
  guide_id: string | null
  quiz_id: string | null
}

/** The newest events: each source is cut to its own 10 newest, then merged and cut again. */
async function recentRowsQuery(db: Db, auth: Auth): Promise<RecentRow[]> {
  const result = await sql<RecentRow>`
    SELECT kind, at, topic_id, title, thread_id, guide_id, quiz_id FROM (
      (SELECT 'question' AS kind, message.created_at AS at, thread.topic_id, thread.title,
        thread.id AS thread_id, NULL::text AS guide_id, NULL::text AS quiz_id, message.id AS id
      FROM message
      JOIN thread ON thread.id = message.thread_id
      WHERE ${ownedBy('message', auth)}
        AND ${isThreadLive}
        AND message.role = 'user'
        AND message.status <> 'failed'
      ORDER BY message.created_at DESC, message.id DESC
      LIMIT ${RECENT_LIMIT})
      UNION ALL
      (SELECT 'step', guide_step.done_at, guide.topic_id, guide_step.title,
        guide.thread_id, guide.id, NULL::text, guide_step.id
      FROM guide_step
      JOIN guide ON guide.id = guide_step.guide_id
      JOIN thread ON thread.id = guide.thread_id
      WHERE ${ownedBy('guide_step', auth)}
        AND ${isThreadLive}
        AND guide_step.done_at IS NOT NULL
      ORDER BY guide_step.done_at DESC, guide_step.id DESC
      LIMIT ${RECENT_LIMIT})
      UNION ALL
      (SELECT 'attempt', quiz_attempt.submitted_at, quiz.topic_id,
        'Scored ' || quiz_attempt.score || ' of ' || quiz_attempt.total || ' on '
          || CASE quiz.difficulty WHEN 'easy' THEN 'an' ELSE 'a' END
          || ' ' || quiz.difficulty || ' ' || topic.name || ' quiz',
        NULL::text, NULL::text, quiz.id, quiz_attempt.id
      FROM quiz_attempt
      JOIN quiz ON quiz.id = quiz_attempt.quiz_id
      JOIN topic ON topic.id = quiz.topic_id
      LEFT JOIN thread ON thread.id = quiz.thread_id
      WHERE ${ownedBy('quiz_attempt', auth)}
        AND ${isQuizLive}
      ORDER BY quiz_attempt.submitted_at DESC, quiz_attempt.id DESC
      LIMIT ${RECENT_LIMIT})
    ) AS event
    ORDER BY at DESC, id DESC
    LIMIT ${RECENT_LIMIT}`.execute(db)
  return result.rows
}

const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS

/**
 * Streak over distinct local `YYYY-MM-DD` days. `current` counts consecutive active days ending
 * today, or ending yesterday while today is still empty; otherwise 0.
 */
export function computeStreak(days: string[], today: string): StreakDto {
  const numbers = [...new Set(days.map(dayNumber))].sort((a, b) => a - b)
  const active = new Set(numbers)
  const todayNumber = dayNumber(today)
  const isActiveToday = active.has(todayNumber)

  let longest = 0
  let run = 0
  let previous: number | null = null
  for (const value of numbers) {
    run = previous !== null && value === previous + 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = value
  }

  let current = 0
  for (let day = isActiveToday ? todayNumber : todayNumber - 1; active.has(day); day -= 1) {
    current += 1
  }
  return { current, longest, isActiveToday }
}
