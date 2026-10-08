import { servicesOf } from '../../context.js'
import type { IdParams } from '../../lib/validation.js'
import { getAuth } from '../../middleware/auth.js'
import type { Handler } from '../../middleware/validate.js'
import type { StepParams, UpdateStepBody } from './validation.js'

/** Generates a guide from the thread `:id`: 201 `{ guide }`. */
export const create: Handler<IdParams> = async (req, res) => {
  const guide = await servicesOf(req).guide.create(getAuth(req), req.params.id)
  res.status(201).json({ guide })
}

/** The guide with its steps in order: `{ guide }`. */
export const get: Handler<IdParams> = async (req, res) => {
  const guide = await servicesOf(req).guide.get(getAuth(req), req.params.id)
  res.json({ guide })
}

/** Marks a step done or not done, or reveals its hint: `{ step }`. */
export const updateStep: Handler<StepParams, UpdateStepBody> = async (req, res) => {
  const { id, stepId } = req.params
  const step = await servicesOf(req).guide.updateStep(getAuth(req), id, stepId, req.body)
  res.json({ step })
}
