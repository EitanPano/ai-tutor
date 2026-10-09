import { z } from 'zod'

/**
 * The guide the model must produce. The API may not enforce every length or count constraint of
 * a structured-output schema, so the service re-validates the output with this same schema.
 */
const GuideStepDraftSchema = z.object({
  title: z.string().min(1).max(120),
  /** Markdown, no raw HTML. */
  body: z.string().min(1).max(4000),
  code: z.string().max(4000).nullable(),
  codeLanguage: z.string().max(32).nullable(),
  hint: z.string().min(1).max(1000)
})

export const GuideDraftSchema = z.object({
  title: z.string().min(1).max(120),
  steps: z.array(GuideStepDraftSchema).min(3).max(8)
})

export type GuideDraft = z.infer<typeof GuideDraftSchema>
