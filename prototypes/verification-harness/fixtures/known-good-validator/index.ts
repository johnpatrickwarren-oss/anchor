// Public barrel for the draft 2020-12 JSON Schema validator.

import { Registry, type Schema } from "./registry.ts";
import { validateSchema, type ValidationError } from "./validate.ts";

export function validate(
  schema: unknown,
  instance: unknown,
  options?: { remotes?: Record<string, unknown> },
): { valid: boolean; errors?: unknown[] } {
  const registry = new Registry(options?.remotes);
  const rootBase = registry.register(schema);
  const errors: ValidationError[] = [];
  const out = validateSchema(schema as Schema, instance, {
    registry,
    baseURI: rootBase,
    dynamicScope: [rootBase],
    errors,
  }, "");
  if (out.valid) return { valid: true };
  return { valid: false, errors };
}

export default validate;
