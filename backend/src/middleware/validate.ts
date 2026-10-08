import type { Request, RequestHandler } from 'express'
import type { z } from 'zod'

// From `express`: the `express-serve-static-core` types do not resolve from backend/.
export type ParamsDictionary = Request['params']
export type Query = Request['query']

/**
 * The type of every generic middleware. Its query is `unknown`, so it fits a route whose query
 * schema has a required non-string output.
 */
export type Middleware = RequestHandler<ParamsDictionary, unknown, unknown, unknown>

export type ValidateSpec = { params?: z.ZodType; query?: z.ZodType; body?: z.ZodType }

export type InferParams<S extends ValidateSpec> = S extends { params: infer P extends z.ZodType }
  ? z.output<P>
  : ParamsDictionary
export type InferBody<S extends ValidateSpec> = S extends { body: infer B extends z.ZodType }
  ? z.output<B>
  : unknown
export type InferQuery<S extends ValidateSpec> = S extends { query: infer Q extends z.ZodType }
  ? z.output<Q>
  : Query

/**
 * Parses params, then query, then body, and writes each parsed value back, so the handler reads
 * the schema's output. A part without a schema is left untouched. A `ZodError` propagates to the
 * error middleware (400 `validation_failed`).
 */
export function validate<S extends ValidateSpec>(
  spec: S
): RequestHandler<InferParams<S>, unknown, InferBody<S>, InferQuery<S>> {
  return (req, _res, next) => {
    if (spec.params) req.params = spec.params.parse(req.params) as InferParams<S>
    if (spec.query) {
      // Express 5 defines `req.query` as a getter without a setter: assigning it throws.
      Object.defineProperty(req, 'query', {
        value: spec.query.parse(req.query),
        writable: true,
        enumerable: true,
        configurable: true
      })
    }
    if (spec.body) req.body = spec.body.parse(req.body) as InferBody<S>
    next()
  }
}
