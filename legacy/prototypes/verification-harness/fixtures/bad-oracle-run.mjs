// Independent acceptance oracle for a JSON Schema (draft 2020-12) validator.
// Derived from the SPEC alone. Only `valid` is graded.
//
// Public API under test:
//   validate(schema, instance, options?) -> { valid: boolean, errors?: unknown[] }
// where options = { remotes?: Record<string, unknown> }.

import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Case list. Each: { label, schema, instance, valid: <expected boolean>, options? }
// Instances that need a real own "__proto__"/"constructor"/"toString" key are
// built with JSON.parse so the key is an own data property, not a prototype op.
// ---------------------------------------------------------------------------

const J = (s) => JSON.parse(s);

const cases = [
  // ---- empty / boolean schemas -------------------------------------------
  { label: "empty schema {} accepts string", schema: {}, instance: "x", valid: true },
  { label: "empty schema {} accepts null", schema: {}, instance: null, valid: true },
  { label: "empty schema {} accepts object", schema: {}, instance: { a: 1 }, valid: true },
  { label: "true schema accepts string", schema: true, instance: "x", valid: true },
  { label: "true schema accepts null", schema: true, instance: null, valid: true },
  { label: "true schema accepts object", schema: true, instance: {}, valid: true },
  { label: "false schema rejects string", schema: false, instance: "x", valid: false },
  { label: "false schema rejects null", schema: false, instance: null, valid: false },
  { label: "false schema rejects 0", schema: false, instance: 0, valid: false },
  { label: "false schema rejects {}", schema: false, instance: {}, valid: false },

  // ---- type ---------------------------------------------------------------
  { label: "type string ok", schema: { type: "string" }, instance: "hello", valid: true },
  { label: "type string rejects number", schema: { type: "string" }, instance: 5, valid: false },
  { label: "type number ok", schema: { type: "number" }, instance: 1.5, valid: true },
  { label: "type number accepts integer-valued", schema: { type: "number" }, instance: 5, valid: true },
  { label: "type number rejects boolean true", schema: { type: "number" }, instance: true, valid: false },
  { label: "type number rejects string", schema: { type: "number" }, instance: "5", valid: false },
  { label: "type integer accepts int", schema: { type: "integer" }, instance: 5, valid: true },
  { label: "type integer accepts 1.0", schema: { type: "integer" }, instance: 1.0, valid: true },
  { label: "type integer accepts 1e2", schema: { type: "integer" }, instance: 1e2, valid: true },
  { label: "type integer rejects 1.5", schema: { type: "integer" }, instance: 1.5, valid: false },
  { label: "type integer rejects string", schema: { type: "integer" }, instance: "1", valid: false },
  { label: "type integer big int ok", schema: { type: "integer" }, instance: 100000000000, valid: true },
  { label: "type boolean ok", schema: { type: "boolean" }, instance: true, valid: true },
  { label: "type boolean rejects 1", schema: { type: "boolean" }, instance: 1, valid: false },
  { label: "type boolean rejects 0", schema: { type: "boolean" }, instance: 0, valid: false },
  { label: "type null ok", schema: { type: "null" }, instance: null, valid: true },
  { label: "type null rejects 0", schema: { type: "null" }, instance: 0, valid: false },
  { label: "type null rejects false", schema: { type: "null" }, instance: false, valid: false },
  { label: "type array ok", schema: { type: "array" }, instance: [], valid: true },
  { label: "type array rejects object", schema: { type: "array" }, instance: {}, valid: false },
  { label: "type object ok", schema: { type: "object" }, instance: {}, valid: true },
  { label: "type object rejects null", schema: { type: "object" }, instance: null, valid: false },
  { label: "type object rejects array", schema: { type: "object" }, instance: [], valid: false },
  { label: "type union accepts member", schema: { type: ["string", "number"] }, instance: 5, valid: true },
  { label: "type union accepts other member", schema: { type: ["string", "number"] }, instance: "x", valid: true },
  { label: "type union rejects non-member", schema: { type: ["string", "number"] }, instance: true, valid: false },

  // ---- enum ---------------------------------------------------------------
  { label: "enum match", schema: { enum: [1, 2, 3] }, instance: 2, valid: true },
  { label: "enum no match", schema: { enum: [1, 2, 3] }, instance: 4, valid: false },
  { label: "enum deep object match", schema: { enum: ["a", { x: 1 }] }, instance: { x: 1 }, valid: true },
  { label: "enum deep object order-insensitive", schema: { enum: [{ a: 1, b: 2 }] }, instance: { b: 2, a: 1 }, valid: true },
  { label: "enum null member", schema: { enum: [null, 1] }, instance: null, valid: true },
  { label: "enum empty rejects all", schema: { enum: [] }, instance: 1, valid: false },
  { label: "enum bool not equal to 1", schema: { enum: [true] }, instance: 1, valid: false },
  { label: "enum array exact", schema: { enum: [[1, 2]] }, instance: [1, 2], valid: true },
  { label: "enum array order matters", schema: { enum: [[1, 2]] }, instance: [2, 1], valid: false },

  // ---- const --------------------------------------------------------------
  { label: "const number ok", schema: { const: 5 }, instance: 5, valid: true },
  { label: "const number mismatch", schema: { const: 5 }, instance: 6, valid: false },
  { label: "const object order-insensitive", schema: { const: { a: 1, b: 2 } }, instance: { b: 2, a: 1 }, valid: true },
  { label: "const array exact", schema: { const: [1, 2] }, instance: [1, 2], valid: true },
  { label: "const array order matters", schema: { const: [1, 2] }, instance: [2, 1], valid: false },
  { label: "const null", schema: { const: null }, instance: null, valid: true },
  { label: "const null rejects 0", schema: { const: null }, instance: 0, valid: false },
  { label: "const false rejects 0", schema: { const: false }, instance: 0, valid: false },
  { label: "const false ok", schema: { const: false }, instance: false, valid: true },

  // ---- multipleOf ---------------------------------------------------------
  { label: "multipleOf 2 ok", schema: { multipleOf: 2 }, instance: 10, valid: true },
  { label: "multipleOf 2 fail", schema: { multipleOf: 2 }, instance: 7, valid: false },
  { label: "multipleOf 2 zero ok", schema: { multipleOf: 2 }, instance: 0, valid: true },
  { label: "multipleOf 1.5 ok (4.5)", schema: { multipleOf: 1.5 }, instance: 4.5, valid: true },
  { label: "multipleOf 1.5 ok (0)", schema: { multipleOf: 1.5 }, instance: 0, valid: true },
  { label: "multipleOf 1.5 fail (35)", schema: { multipleOf: 1.5 }, instance: 35, valid: false },
  { label: "multipleOf 0.1 ok (0.3)", schema: { multipleOf: 0.1 }, instance: 0.3, valid: true },
  { label: "multipleOf 0.0001 ok (0.0075)", schema: { multipleOf: 0.0001 }, instance: 0.0075, valid: true },
  { label: "multipleOf ignores non-number", schema: { multipleOf: 2 }, instance: "x", valid: true },

  // ---- maximum / minimum --------------------------------------------------
  { label: "maximum boundary ok", schema: { maximum: 3 }, instance: 3, valid: true },
  { label: "maximum over fail", schema: { maximum: 3 }, instance: 4, valid: false },
  { label: "maximum under ok", schema: { maximum: 3 }, instance: 2, valid: true },
  { label: "maximum ignores string", schema: { maximum: 3 }, instance: "zzz", valid: true },
  { label: "exclusiveMaximum boundary fail", schema: { exclusiveMaximum: 3 }, instance: 3, valid: false },
  { label: "exclusiveMaximum under ok", schema: { exclusiveMaximum: 3 }, instance: 2, valid: true },
  { label: "minimum boundary ok", schema: { minimum: 3 }, instance: 3, valid: true },
  { label: "minimum under fail", schema: { minimum: 3 }, instance: 2, valid: false },
  { label: "exclusiveMinimum boundary fail", schema: { exclusiveMinimum: 3 }, instance: 3, valid: false },
  { label: "exclusiveMinimum over ok", schema: { exclusiveMinimum: 3 }, instance: 4, valid: true },
  { label: "negative minimum", schema: { minimum: -5 }, instance: -5, valid: true },

  // ---- maxLength / minLength (code points) --------------------------------
  { label: "maxLength ok", schema: { maxLength: 2 }, instance: "ab", valid: true },
  { label: "maxLength fail", schema: { maxLength: 2 }, instance: "abc", valid: false },
  { label: "minLength fail", schema: { minLength: 2 }, instance: "a", valid: false },
  { label: "minLength ok", schema: { minLength: 2 }, instance: "ab", valid: true },
  { label: "maxLength counts code points (emoji ok)", schema: { maxLength: 1 }, instance: "\u{1F4A9}", valid: true },
  { label: "maxLength counts code points (2 emoji fail)", schema: { maxLength: 1 }, instance: "\u{1F4A9}\u{1F4A9}", valid: false },
  { label: "minLength counts code points (emoji satisfies 1)", schema: { minLength: 1 }, instance: "\u{1F4A9}", valid: true },
  { label: "maxLength ignores number", schema: { maxLength: 1 }, instance: 12345, valid: true },

  // ---- pattern ------------------------------------------------------------
  { label: "pattern anchored match", schema: { pattern: "^a" }, instance: "abc", valid: true },
  { label: "pattern anchored fail", schema: { pattern: "^a" }, instance: "bcd", valid: false },
  { label: "pattern unanchored matches substring", schema: { pattern: "[0-9]+" }, instance: "abc123", valid: true },
  { label: "pattern unanchored no match", schema: { pattern: "[0-9]+" }, instance: "abc", valid: false },
  { label: "pattern ignores number", schema: { pattern: "^a" }, instance: 5, valid: true },

  // ---- maxItems / minItems ------------------------------------------------
  { label: "maxItems ok", schema: { maxItems: 2 }, instance: [1, 2], valid: true },
  { label: "maxItems fail", schema: { maxItems: 2 }, instance: [1, 2, 3], valid: false },
  { label: "minItems fail", schema: { minItems: 2 }, instance: [1], valid: false },
  { label: "minItems ignores non-array", schema: { minItems: 5 }, instance: "x", valid: true },

  // ---- uniqueItems --------------------------------------------------------
  { label: "uniqueItems ok", schema: { uniqueItems: true }, instance: [1, 2, 3], valid: true },
  { label: "uniqueItems dup fail", schema: { uniqueItems: true }, instance: [1, 2, 2], valid: false },
  { label: "uniqueItems deep dup fail", schema: { uniqueItems: true }, instance: [{ a: 1 }, { a: 1 }], valid: false },
  { label: "uniqueItems object order dup fail", schema: { uniqueItems: true }, instance: [{ a: 1, b: 2 }, { b: 2, a: 1 }], valid: false },
  { label: "uniqueItems nested arrays distinct", schema: { uniqueItems: true }, instance: [[1, 2], [2, 1]], valid: true },
  { label: "uniqueItems nested arrays dup fail", schema: { uniqueItems: true }, instance: [[1, 2], [1, 2]], valid: false },
  { label: "uniqueItems true vs 1 distinct", schema: { uniqueItems: true }, instance: [true, 1], valid: true },
  { label: "uniqueItems false vs 0 distinct", schema: { uniqueItems: true }, instance: [false, 0], valid: true },
  { label: "uniqueItems empty ok", schema: { uniqueItems: true }, instance: [], valid: true },
  { label: "uniqueItems false allows dup", schema: { uniqueItems: false }, instance: [1, 1], valid: true },

  // ---- maxProperties / minProperties --------------------------------------
  { label: "maxProperties ok", schema: { maxProperties: 2 }, instance: { a: 1, b: 2 }, valid: true },
  { label: "maxProperties fail", schema: { maxProperties: 2 }, instance: { a: 1, b: 2, c: 3 }, valid: false },
  { label: "minProperties fail", schema: { minProperties: 2 }, instance: { a: 1 }, valid: false },
  { label: "minProperties ignores non-object", schema: { minProperties: 5 }, instance: [1], valid: true },

  // ---- required -----------------------------------------------------------
  { label: "required present", schema: { required: ["a"] }, instance: { a: 1 }, valid: true },
  { label: "required missing fail", schema: { required: ["a"] }, instance: { b: 2 }, valid: false },
  { label: "required empty obj fail", schema: { required: ["a"] }, instance: {}, valid: false },
  { label: "required empty list ok", schema: { required: [] }, instance: {}, valid: true },
  { label: "required ignores non-object", schema: { required: ["a"] }, instance: "x", valid: true },
  { label: "required __proto__ as data key", schema: { required: ["__proto__"] }, instance: J('{"__proto__": 1}'), valid: true },
  { label: "required __proto__ missing fail", schema: { required: ["__proto__"] }, instance: {}, valid: false },
  { label: "required toString not from prototype", schema: { required: ["toString"] }, instance: {}, valid: false },
  { label: "required toString as data key", schema: { required: ["toString"] }, instance: J('{"toString": 1}'), valid: true },
  { label: "required constructor not from prototype", schema: { required: ["constructor"] }, instance: {}, valid: false },

  // ---- properties ---------------------------------------------------------
  { label: "properties value ok", schema: { properties: { a: { type: "number" } } }, instance: { a: 1 }, valid: true },
  { label: "properties value fail", schema: { properties: { a: { type: "number" } } }, instance: { a: "x" }, valid: false },
  { label: "properties absent key ok", schema: { properties: { a: { type: "number" } } }, instance: { b: 1 }, valid: true },
  { label: "properties true subschema", schema: { properties: { a: true } }, instance: { a: 1 }, valid: true },
  { label: "properties false subschema present fail", schema: { properties: { a: false } }, instance: { a: 1 }, valid: false },
  { label: "properties false subschema absent ok", schema: { properties: { a: false } }, instance: { b: 1 }, valid: true },
  { label: "properties __proto__ key validated", schema: { properties: { __proto__: { type: "number" } } }, instance: J('{"__proto__": "x"}'), valid: false },
  { label: "properties __proto__ key ok", schema: { properties: { __proto__: { type: "number" } } }, instance: J('{"__proto__": 5}'), valid: true },

  // ---- patternProperties --------------------------------------------------
  { label: "patternProperties match ok", schema: { patternProperties: { "^x": { type: "number" } } }, instance: { x1: 5 }, valid: true },
  { label: "patternProperties match fail", schema: { patternProperties: { "^x": { type: "number" } } }, instance: { x1: "s" }, valid: false },
  { label: "patternProperties non-match ignored", schema: { patternProperties: { "^x": { type: "number" } } }, instance: { y: "s" }, valid: true },

  // ---- additionalProperties (local only) ----------------------------------
  { label: "additionalProperties false with properties ok", schema: { properties: { a: {} }, additionalProperties: false }, instance: { a: 1 }, valid: true },
  { label: "additionalProperties false extra fail", schema: { properties: { a: {} }, additionalProperties: false }, instance: { a: 1, b: 2 }, valid: false },
  { label: "additionalProperties schema applies to extras", schema: { properties: { a: {} }, additionalProperties: { type: "number" } }, instance: { a: 1, b: "x" }, valid: false },
  { label: "additionalProperties schema extras ok", schema: { properties: { a: {} }, additionalProperties: { type: "number" } }, instance: { a: 1, b: 5 }, valid: true },
  { label: "additionalProperties respects patternProperties", schema: { patternProperties: { "^x": {} }, additionalProperties: false }, instance: { x1: 1 }, valid: true },
  { label: "additionalProperties false catches non-pattern", schema: { patternProperties: { "^x": {} }, additionalProperties: false }, instance: { x1: 1, y: 2 }, valid: false },
  { label: "additionalProperties does NOT see $ref props", schema: { $defs: { b: { properties: { a: {} } } }, $ref: "#/$defs/b", additionalProperties: false }, instance: { a: 1 }, valid: false },
  { label: "additionalProperties does NOT see allOf props", schema: { allOf: [{ properties: { a: {} } }], additionalProperties: false }, instance: { a: 1 }, valid: false },

  // ---- propertyNames ------------------------------------------------------
  { label: "propertyNames maxLength ok", schema: { propertyNames: { maxLength: 3 } }, instance: { abc: 1 }, valid: true },
  { label: "propertyNames maxLength fail", schema: { propertyNames: { maxLength: 3 } }, instance: { abcd: 1 }, valid: false },
  { label: "propertyNames pattern ok", schema: { propertyNames: { pattern: "^a" } }, instance: { a1: 1 }, valid: true },
  { label: "propertyNames pattern fail", schema: { propertyNames: { pattern: "^a" } }, instance: { b: 1 }, valid: false },
  { label: "propertyNames enum fail", schema: { propertyNames: { enum: ["a", "b"] } }, instance: { a: 1, c: 3 }, valid: false },

  // ---- dependentRequired --------------------------------------------------
  { label: "dependentRequired missing dep fail", schema: { dependentRequired: { a: ["b"] } }, instance: { a: 1 }, valid: false },
  { label: "dependentRequired satisfied", schema: { dependentRequired: { a: ["b"] } }, instance: { a: 1, b: 2 }, valid: true },
  { label: "dependentRequired trigger absent ok", schema: { dependentRequired: { a: ["b"] } }, instance: { b: 2 }, valid: true },
  { label: "dependentRequired empty obj ok", schema: { dependentRequired: { a: ["b"] } }, instance: {}, valid: true },
  { label: "dependentRequired multi missing fail", schema: { dependentRequired: { a: ["b", "c"] } }, instance: { a: 1, b: 2 }, valid: false },
  { label: "dependentRequired multi ok", schema: { dependentRequired: { a: ["b", "c"] } }, instance: { a: 1, b: 2, c: 3 }, valid: true },

  // ---- dependentSchemas ---------------------------------------------------
  { label: "dependentSchemas applies fail", schema: { dependentSchemas: { a: { required: ["b"] } } }, instance: { a: 1 }, valid: false },
  { label: "dependentSchemas satisfied", schema: { dependentSchemas: { a: { required: ["b"] } } }, instance: { a: 1, b: 2 }, valid: true },
  { label: "dependentSchemas trigger absent ok", schema: { dependentSchemas: { a: { required: ["b"] } } }, instance: { c: 1 }, valid: true },
  { label: "dependentSchemas false trigger present fail", schema: { dependentSchemas: { a: false } }, instance: { a: 1 }, valid: false },
  { label: "dependentSchemas false trigger absent ok", schema: { dependentSchemas: { a: false } }, instance: { b: 1 }, valid: true },

  // ---- prefixItems --------------------------------------------------------
  { label: "prefixItems tuple ok", schema: { prefixItems: [{ type: "number" }, { type: "string" }] }, instance: [1, "x"], valid: true },
  { label: "prefixItems tuple fail", schema: { prefixItems: [{ type: "number" }, { type: "string" }] }, instance: [1, 2], valid: false },
  { label: "prefixItems short array ok", schema: { prefixItems: [{ type: "number" }, { type: "string" }] }, instance: [1], valid: true },
  { label: "prefixItems extra allowed (no items)", schema: { prefixItems: [{ type: "number" }] }, instance: [1, "anything", true], valid: true },

  // ---- items --------------------------------------------------------------
  { label: "items all ok", schema: { items: { type: "number" } }, instance: [1, 2, 3], valid: true },
  { label: "items one fail", schema: { items: { type: "number" } }, instance: [1, "x"], valid: false },
  { label: "items empty ok", schema: { items: { type: "number" } }, instance: [], valid: true },
  { label: "items after prefixItems ok", schema: { prefixItems: [{ type: "number" }], items: { type: "string" } }, instance: [1, "a", "b"], valid: true },
  { label: "items after prefixItems fail", schema: { prefixItems: [{ type: "number" }], items: { type: "string" } }, instance: [1, "a", 2], valid: false },
  { label: "items false rejects extra", schema: { prefixItems: [{}], items: false }, instance: [1, 2], valid: false },
  { label: "items false tuple-only ok", schema: { prefixItems: [{}], items: false }, instance: [1], valid: true },

  // ---- contains / minContains / maxContains -------------------------------
  { label: "contains match ok", schema: { contains: { minimum: 5 } }, instance: [3, 4, 5], valid: true },
  { label: "contains no match fail", schema: { contains: { minimum: 5 } }, instance: [3, 4, 4], valid: false },
  { label: "contains empty array fail", schema: { contains: { minimum: 5 } }, instance: [], valid: false },
  { label: "contains ignores non-array", schema: { contains: { const: 1 } }, instance: "x", valid: true },
  { label: "minContains 2 fail (1 match)", schema: { contains: { const: 1 }, minContains: 2 }, instance: [1, 2], valid: false },
  { label: "minContains 2 ok (2 matches)", schema: { contains: { const: 1 }, minContains: 2 }, instance: [1, 1, 3], valid: true },
  { label: "minContains 0 empty ok", schema: { contains: { const: 5 }, minContains: 0 }, instance: [], valid: true },
  { label: "minContains 0 no match ok", schema: { contains: { const: 5 }, minContains: 0 }, instance: [1, 2, 3], valid: true },
  { label: "maxContains 1 over fail", schema: { contains: { type: "number" }, maxContains: 1 }, instance: [1, 2], valid: false },
  { label: "maxContains 1 ok", schema: { contains: { type: "number" }, maxContains: 1 }, instance: [1, "x"], valid: true },
  { label: "minContains0/maxContains1 over fail", schema: { contains: { const: 5 }, minContains: 0, maxContains: 1 }, instance: [5, 5], valid: false },
  { label: "minContains0/maxContains1 zero ok", schema: { contains: { const: 5 }, minContains: 0, maxContains: 1 }, instance: [1, 2], valid: true },

  // ---- allOf / anyOf / oneOf / not ----------------------------------------
  { label: "allOf both ok", schema: { allOf: [{ type: "number" }, { minimum: 5 }] }, instance: 6, valid: true },
  { label: "allOf one fail", schema: { allOf: [{ type: "number" }, { minimum: 5 }] }, instance: 4, valid: false },
  { label: "allOf type fail", schema: { allOf: [{ type: "number" }, { minimum: 5 }] }, instance: "x", valid: false },
  { label: "anyOf first ok", schema: { anyOf: [{ type: "number" }, { type: "string" }] }, instance: 5, valid: true },
  { label: "anyOf second ok", schema: { anyOf: [{ type: "number" }, { type: "string" }] }, instance: "x", valid: true },
  { label: "anyOf none fail", schema: { anyOf: [{ type: "number" }, { type: "string" }] }, instance: true, valid: false },
  { label: "oneOf exactly one (first)", schema: { oneOf: [{ multipleOf: 2 }, { multipleOf: 3 }] }, instance: 4, valid: true },
  { label: "oneOf exactly one (second)", schema: { oneOf: [{ multipleOf: 2 }, { multipleOf: 3 }] }, instance: 9, valid: true },
  { label: "oneOf both fail", schema: { oneOf: [{ multipleOf: 2 }, { multipleOf: 3 }] }, instance: 6, valid: false },
  { label: "oneOf none fail", schema: { oneOf: [{ multipleOf: 2 }, { multipleOf: 3 }] }, instance: 5, valid: false },
  { label: "not ok", schema: { not: { type: "string" } }, instance: 5, valid: true },
  { label: "not fail", schema: { not: { type: "string" } }, instance: "x", valid: false },
  { label: "not double negation ok", schema: { not: { not: { type: "number" } } }, instance: 5, valid: true },
  { label: "not double negation fail", schema: { not: { not: { type: "number" } } }, instance: "x", valid: false },

  // ---- if / then / else ---------------------------------------------------
  { label: "if/then satisfied", schema: { if: { type: "number" }, then: { minimum: 5 } }, instance: 6, valid: true },
  { label: "if/then violated", schema: { if: { type: "number" }, then: { minimum: 5 } }, instance: 4, valid: false },
  { label: "if false skips then", schema: { if: { type: "number" }, then: { minimum: 5 } }, instance: "x", valid: true },
  { label: "if/else applies", schema: { if: { const: "a" }, then: {}, else: { type: "number" } }, instance: 5, valid: true },
  { label: "if/else then-branch", schema: { if: { const: "a" }, then: {}, else: { type: "number" } }, instance: "a", valid: true },
  { label: "if/else else-fail", schema: { if: { const: "a" }, then: {}, else: { type: "number" } }, instance: "b", valid: false },
  { label: "if alone no effect", schema: { if: { type: "number" } }, instance: "x", valid: true },

  // ---- $ref / $defs / siblings --------------------------------------------
  { label: "$ref to $defs ok", schema: { $defs: { pos: { minimum: 0 } }, $ref: "#/$defs/pos" }, instance: 5, valid: true },
  { label: "$ref to $defs fail", schema: { $defs: { pos: { minimum: 0 } }, $ref: "#/$defs/pos" }, instance: -1, valid: false },
  { label: "$ref sibling keyword evaluated (2020-12)", schema: { $defs: { pos: { minimum: 0 } }, $ref: "#/$defs/pos", maximum: 10 }, instance: 11, valid: false },
  { label: "$ref sibling keyword ok", schema: { $defs: { pos: { minimum: 0 } }, $ref: "#/$defs/pos", maximum: 10 }, instance: 5, valid: true },
  {
    label: "recursive $ref tree valid",
    schema: { $defs: { node: { type: "object", properties: { children: { type: "array", items: { $ref: "#/$defs/node" } } } } }, $ref: "#/$defs/node" },
    instance: { children: [{ children: [] }, { children: [{ children: [] }] }] },
    valid: true,
  },
  {
    label: "recursive $ref tree invalid (bad leaf)",
    schema: { $defs: { node: { type: "object", properties: { children: { type: "array", items: { $ref: "#/$defs/node" } } } } }, $ref: "#/$defs/node" },
    instance: { children: [{ children: "notarray" }] },
    valid: false,
  },

  // ---- $anchor ------------------------------------------------------------
  { label: "$anchor resolve ok", schema: { $defs: { a: { $anchor: "foo", type: "number" } }, $ref: "#foo" }, instance: 5, valid: true },
  { label: "$anchor resolve fail", schema: { $defs: { a: { $anchor: "foo", type: "number" } }, $ref: "#foo" }, instance: "x", valid: false },

  // ---- format is annotation-only (must NOT assert) ------------------------
  { label: "format email not asserted", schema: { format: "email" }, instance: "not-an-email", valid: true },
  { label: "format date not asserted", schema: { type: "string", format: "date" }, instance: "nonsense", valid: true },

  // ---- unevaluatedProperties (cross-cutting) ------------------------------
  { label: "unevaluatedProperties false ok", schema: { type: "object", properties: { a: {} }, unevaluatedProperties: false }, instance: { a: 1 }, valid: true },
  { label: "unevaluatedProperties false extra fail", schema: { type: "object", properties: { a: {} }, unevaluatedProperties: false }, instance: { a: 1, b: 2 }, valid: false },
  { label: "unevaluatedProperties empty obj ok", schema: { properties: { a: {} }, unevaluatedProperties: false }, instance: {}, valid: true },
  { label: "unevaluatedProperties sees allOf ok", schema: { allOf: [{ properties: { a: {} } }], unevaluatedProperties: false }, instance: { a: 1 }, valid: true },
  { label: "unevaluatedProperties allOf extra fail", schema: { allOf: [{ properties: { a: {} } }], unevaluatedProperties: false }, instance: { a: 1, b: 2 }, valid: false },
  { label: "unevaluatedProperties combines local+allOf ok", schema: { properties: { a: {} }, allOf: [{ properties: { b: {} } }], unevaluatedProperties: false }, instance: { a: 1, b: 2 }, valid: true },
  { label: "unevaluatedProperties combines local+allOf extra fail", schema: { properties: { a: {} }, allOf: [{ properties: { b: {} } }], unevaluatedProperties: false }, instance: { a: 1, b: 2, c: 3 }, valid: false },
  { label: "unevaluatedProperties sees $ref ok", schema: { $defs: { b: { properties: { a: {} } } }, $ref: "#/$defs/b", unevaluatedProperties: false }, instance: { a: 1 }, valid: true },
  { label: "unevaluatedProperties $ref extra fail", schema: { $defs: { b: { properties: { a: {} } } }, $ref: "#/$defs/b", unevaluatedProperties: false }, instance: { a: 1, c: 3 }, valid: false },
  { label: "unevaluatedProperties schema applies to unevaluated ok", schema: { properties: { a: { type: "string" } }, unevaluatedProperties: { type: "number" } }, instance: { a: "x", b: 5 }, valid: true },
  { label: "unevaluatedProperties schema applies to unevaluated fail", schema: { properties: { a: { type: "string" } }, unevaluatedProperties: { type: "number" } }, instance: { a: "x", b: "y" }, valid: false },
  { label: "unevaluatedProperties sees patternProperties ok", schema: { patternProperties: { "^x": {} }, unevaluatedProperties: false }, instance: { x1: 1 }, valid: true },
  { label: "unevaluatedProperties patternProperties miss fail", schema: { patternProperties: { "^x": {} }, unevaluatedProperties: false }, instance: { y: 1 }, valid: false },
  { label: "unevaluatedProperties additionalProperties evaluates all", schema: { properties: { a: {} }, additionalProperties: {}, unevaluatedProperties: false }, instance: { a: 1, b: 2 }, valid: true },

  // ---- unevaluatedItems (cross-cutting) -----------------------------------
  { label: "unevaluatedItems false ok", schema: { prefixItems: [{}], unevaluatedItems: false }, instance: [1], valid: true },
  { label: "unevaluatedItems false extra fail", schema: { prefixItems: [{}], unevaluatedItems: false }, instance: [1, 2], valid: false },
  { label: "unevaluatedItems items evaluates all ok", schema: { prefixItems: [{}], items: {}, unevaluatedItems: false }, instance: [1, 2, 3], valid: true },
  { label: "unevaluatedItems sees allOf ok", schema: { allOf: [{ prefixItems: [{}] }], unevaluatedItems: false }, instance: [1], valid: true },
  { label: "unevaluatedItems allOf extra fail", schema: { allOf: [{ prefixItems: [{}] }], unevaluatedItems: false }, instance: [1, 2], valid: false },
  { label: "unevaluatedItems schema applies ok", schema: { prefixItems: [{ type: "number" }], unevaluatedItems: { type: "string" } }, instance: [1, "x"], valid: true },
  { label: "unevaluatedItems schema applies fail", schema: { prefixItems: [{ type: "number" }], unevaluatedItems: { type: "string" } }, instance: [1, 2], valid: false },

  // ---- $dynamicRef / $dynamicAnchor (recursion via dynamic scope) ---------
  {
    label: "$dynamicRef recursive tree valid",
    schema: {
      $id: "https://example.com/tree",
      $dynamicAnchor: "node",
      type: "object",
      properties: { data: {}, children: { type: "array", items: { $dynamicRef: "#node" } } },
      required: ["data"],
    },
    instance: { data: 1, children: [{ data: 2 }, { data: 3, children: [{ data: 4 }] }] },
    valid: true,
  },
  {
    label: "$dynamicRef recursive tree invalid (missing data deep)",
    schema: {
      $id: "https://example.com/tree",
      $dynamicAnchor: "node",
      type: "object",
      properties: { data: {}, children: { type: "array", items: { $dynamicRef: "#node" } } },
      required: ["data"],
    },
    instance: { data: 1, children: [{ data: 2, children: [{ nope: 4 }] }] },
    valid: false,
  },

  // ---- remote refs (options.remotes) --------------------------------------
  {
    label: "remote $ref absolute ok",
    schema: { $ref: "https://example.com/foo" },
    instance: 5,
    valid: true,
    options: { remotes: { "https://example.com/foo": { type: "number" } } },
  },
  {
    label: "remote $ref absolute fail",
    schema: { $ref: "https://example.com/foo" },
    instance: "x",
    valid: false,
    options: { remotes: { "https://example.com/foo": { type: "number" } } },
  },
  {
    label: "remote $ref with pointer ok",
    schema: { $ref: "https://example.com/foo#/$defs/n" },
    instance: 5,
    valid: true,
    options: { remotes: { "https://example.com/foo": { $defs: { n: { type: "number" } } } } },
  },
  {
    label: "remote $ref with pointer fail",
    schema: { $ref: "https://example.com/foo#/$defs/n" },
    instance: "x",
    valid: false,
    options: { remotes: { "https://example.com/foo": { $defs: { n: { type: "number" } } } } },
  },
  {
    label: "remote $ref relative resolved against $id base ok",
    schema: { $id: "https://example.com/root.json", $ref: "sub.json" },
    instance: 5,
    valid: true,
    options: { remotes: { "https://example.com/sub.json": { type: "number" } } },
  },
  {
    label: "remote $ref relative resolved against $id base fail",
    schema: { $id: "https://example.com/root.json", $ref: "sub.json" },
    instance: "x",
    valid: false,
    options: { remotes: { "https://example.com/sub.json": { type: "number" } } },
  },

  // ---- combined / nested sanity ------------------------------------------
  {
    label: "nested object schema valid",
    schema: { type: "object", properties: { name: { type: "string" }, age: { type: "integer", minimum: 0 }, tags: { type: "array", items: { type: "string" }, uniqueItems: true } }, required: ["name"] },
    instance: { name: "x", age: 3, tags: ["a", "b"] },
    valid: true,
  },
  {
    label: "nested object schema invalid (dup tags)",
    schema: { type: "object", properties: { name: { type: "string" }, age: { type: "integer", minimum: 0 }, tags: { type: "array", items: { type: "string" }, uniqueItems: true } }, required: ["name"] },
    instance: { name: "x", age: 3, tags: ["a", "a"] },
    valid: false,
  },
  {
    label: "nested object schema invalid (negative age)",
    schema: { type: "object", properties: { name: { type: "string" }, age: { type: "integer", minimum: 0 } }, required: ["name"] },
    instance: { name: "x", age: -1 },
    valid: false,
  },
];

function resolveValidate(mod) {
  if (typeof mod?.validate === "function") return mod.validate;
  if (typeof mod?.default?.validate === "function") return mod.default.validate;
  if (typeof mod?.default === "function") return mod.default;
  return undefined;
}

export async function grade(buildModulePath) {
  const failures = [];
  let pass = 0;
  const total = cases.length;

  let validate;
  try {
    const mod = await import(pathToFileURL(buildModulePath).href);
    validate = resolveValidate(mod);
  } catch (e) {
    return {
      pass: 0,
      total,
      failures: [{ case: "import build module", expected: "module with validate export", got: "import threw: " + (e?.message ?? String(e)) }],
    };
  }

  if (typeof validate !== "function") {
    return {
      pass: 0,
      total,
      failures: [{ case: "resolve validate export", expected: "function validate(schema, instance, options?)", got: "no callable validate found on module" }],
    };
  }

  for (const c of cases) {
    try {
      const result = c.options !== undefined
        ? validate(c.schema, c.instance, c.options)
        : validate(c.schema, c.instance);

      if (result === null || typeof result !== "object" || !("valid" in result)) {
        failures.push({ case: c.label, expected: { valid: c.valid }, got: "result missing .valid: " + JSON.stringify(result) });
        continue;
      }

      const got = Boolean(result.valid);
      if (got === c.valid) {
        pass++;
      } else {
        failures.push({ case: c.label, expected: c.valid, got });
      }
    } catch (e) {
      failures.push({ case: c.label, expected: c.valid, got: "threw: " + (e?.message ?? String(e)) });
    }
  }

  return { pass, total, failures };
}
