import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormatsModule from 'ajv-formats'
import { expect } from 'vitest'
import { parse } from 'yaml'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const CONTRACT_PATH = path.join(REPO_ROOT, '.orchestrate', 'api-contract.yaml')

type Operation = { responses?: Record<string, { content?: Record<string, { schema?: object }> }> }
type Contract = {
  paths: Record<string, Record<string, Operation>>
  components?: object
}

// ajv-formats is CJS; under NodeNext the default import is typed as the module namespace.
const addFormats = addFormatsModule as unknown as typeof addFormatsModule.default
const contract = parse(readFileSync(CONTRACT_PATH, 'utf8')) as Contract
const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }))
const validators = new Map<string, ValidateFunction>()

function validatorFor(key: string, schema: object): ValidateFunction {
  const cached = validators.get(key)
  if (cached) return cached
  // Embedding `components` lets `#/components/schemas/*` refs resolve against the wrapper root.
  const validate = ajv.compile({ ...schema, components: contract.components })
  validators.set(key, validate)
  return validate
}

/**
 * Asserts the contract declares `method pathTemplate` with `res.status`, and that the JSON body
 * matches the declared application/json schema.
 */
export function expectContract(
  res: { status: number; body: unknown },
  method: string,
  pathTemplate: string
): void {
  const label = `${method.toUpperCase()} ${pathTemplate}`
  const operation = contract.paths[pathTemplate]?.[method.toLowerCase()]
  expect(operation, `contract does not declare ${label}`).toBeDefined()
  const response = operation?.responses?.[String(res.status)]
  expect(
    response,
    `contract does not declare status ${res.status} for ${label} (declared: ${Object.keys(operation?.responses ?? {}).join(', ')})`
  ).toBeDefined()
  const schema = response?.content?.['application/json']?.schema
  if (!schema) return
  const validate = validatorFor(`${label} ${res.status}`, schema)
  const valid = validate(res.body)
  expect(
    valid,
    `${label} ${res.status} body violates the contract: ${ajv.errorsText(validate.errors)}`
  ).toBe(true)
}

/** Validates `body` against `#/components/schemas/<name>` of the contract. */
export function expectSchema(body: unknown, name: string): void {
  const validate = validatorFor(`schema ${name}`, { $ref: `#/components/schemas/${name}` })
  expect(validate(body), `body violates schema ${name}: ${ajv.errorsText(validate.errors)}`).toBe(
    true
  )
}
