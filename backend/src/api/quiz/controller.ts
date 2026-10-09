import { servicesOf } from '../../context.js'
import type { IdParams } from '../../lib/validation.js'
import { getAuth } from '../../middleware/auth.js'
import type { Handler, ParamsDictionary } from '../../middleware/validate.js'
import type { AttemptParams, CreateBody, SubmitAttemptBody } from './validation.js'

/** Generates a quiz from a thread or from a topic: 201 `{ quiz }`. */
export const create: Handler<ParamsDictionary, CreateBody> = async (req, res) => {
  const quiz = await servicesOf(req).quiz.create(getAuth(req), req.body)
  res.status(201).json({ quiz })
}

/** The taker view of the quiz, without the answer key: `{ quiz }`. */
export const get: Handler<IdParams> = async (req, res) => {
  const quiz = await servicesOf(req).quiz.get(getAuth(req), req.params.id)
  res.json({ quiz })
}

/** Grades an attempt on the server: 201 `{ attempt }`. */
export const submitAttempt: Handler<IdParams, SubmitAttemptBody> = async (req, res) => {
  const attempt = await servicesOf(req).quiz.submitAttempt(getAuth(req), req.params.id, req.body)
  res.status(201).json({ attempt })
}

/** A graded attempt of the quiz `:id`: `{ attempt }`. */
export const getAttempt: Handler<AttemptParams> = async (req, res) => {
  const { id, attemptId } = req.params
  const attempt = await servicesOf(req).quiz.getAttempt(getAuth(req), id, attemptId)
  res.json({ attempt })
}
