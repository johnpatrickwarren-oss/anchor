# Build: a JSON Schema (draft 2020-12) validator — dependency-free TypeScript

Build a correct, COMPLETE, dependency-free JSON Schema validator for **draft 2020-12** in
TypeScript under `src/`, with co-located `*.test.ts` tests (`node --test`). No npm dependencies.
Reach a green self-test suite. Be thorough: implement the FULL required keyword set, including the
hard cross-cutting ones.

## Public API (EXACT — the barrel `src/index.ts` must export this; do not rename)

```ts
export function validate(
  schema: unknown,            // a JSON Schema (object or boolean)
  instance: unknown,          // the JSON value to validate
  options?: { remotes?: Record<string, unknown> }  // map of absolute URI -> schema, for $ref to remote URIs
): { valid: boolean; errors?: unknown[] };
```

- `valid` is the only field graded. `errors` is optional/freeform.
- `options.remotes` registers external schemas addressable by absolute URI (e.g.
  `"https://example.com/foo"` or `"http://localhost:1234/subSchemas.json"`). Your `$ref`/`$dynamicRef`
  resolution must consult this map for non-local absolute URIs.

## Scope — full draft 2020-12 keyword set

- **Core:** `$schema`, `$id`, `$ref`, `$defs`, `$anchor`, `$dynamicRef`, `$dynamicAnchor`,
  recursive ref resolution, base-URI resolution (RFC 3986), JSON Pointer fragments, remote refs.
- **Applicators:** `allOf`, `anyOf`, `oneOf`, `not`, `if`/`then`/`else`, `properties`,
  `patternProperties`, `additionalProperties`, `propertyNames`, `dependentSchemas`, `prefixItems`,
  `items`, `contains`, `dependentRequired`.
- **Cross-cutting (do these carefully):** `unevaluatedProperties`, `unevaluatedItems` — these depend
  on which properties/items were evaluated by ALL OTHER applicators (including through `$ref`,
  `allOf`, `if/then/else`, `anyOf`, etc.). Correct behavior requires propagating evaluation
  annotations across the whole keyword set.
- **Assertions:** `type` (incl. `integer`), `enum`, `const`, `multipleOf`, `maximum`,
  `exclusiveMaximum`, `minimum`, `exclusiveMinimum`, `maxLength`/`minLength` (Unicode code points),
  `pattern` (ECMA regex), `maxItems`/`minItems`, `uniqueItems`, `maxContains`/`minContains`,
  `maxProperties`/`minProperties`, `required`.
- Boolean schemas (`true`/`false`) at any position. `format` is annotation-only (do NOT assert).
- Property-name edge cases: treat `__proto__`, `constructor`, `toString` etc. as ordinary data
  properties (use null-prototype maps / `Object.hasOwn`, never prototype lookups).

## Semantics to respect

- Absent keywords pass (open by default). `additionalProperties`/`unevaluatedProperties` only apply
  to properties not already evaluated by `properties`/`patternProperties` (and, for unevaluated, by
  any applicator). `contains` interacts with `minContains`/`maxContains` (incl. `minContains: 0`).
- `$dynamicRef`/`$dynamicAnchor` resolve against the dynamic scope (the chain of schemas entered),
  not just lexical scope.
- Numbers: `1.0` is an integer for `type: "integer"`; `multipleOf` must handle floats robustly.

## Deliverable

- `src/index.ts` exporting `validate` exactly as above, plus whatever internal modules you need
  (keep internal imports extensionless or `.ts` so they resolve under `node --test` with no build).
- Co-located `*.test.ts` covering each keyword and the cross-cutting interactions; green suite.
- Do NOT add npm dependencies. Do NOT look for or assume any external test suite — write your own.
