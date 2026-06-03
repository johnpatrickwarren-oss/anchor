import { test } from "node:test";
import assert from "node:assert";
import { validate } from "./index.ts";

const ok = (schema: unknown, instance: unknown, remotes?: Record<string, unknown>) =>
  assert.equal(validate(schema, instance, remotes ? { remotes } : undefined).valid, true,
    `expected VALID: ${JSON.stringify(instance)}`);
const bad = (schema: unknown, instance: unknown, remotes?: Record<string, unknown>) =>
  assert.equal(validate(schema, instance, remotes ? { remotes } : undefined).valid, false,
    `expected INVALID: ${JSON.stringify(instance)}`);

test("boolean schemas", () => {
  ok(true, 1);
  ok(true, { a: 1 });
  bad(false, 1);
  bad(false, null);
  ok({}, 42);
});

test("type", () => {
  ok({ type: "string" }, "x");
  bad({ type: "string" }, 1);
  ok({ type: "integer" }, 1);
  ok({ type: "integer" }, 1.0);
  bad({ type: "integer" }, 1.5);
  ok({ type: "number" }, 1.5);
  bad({ type: "number" }, true);
  ok({ type: ["string", "null"] }, null);
  ok({ type: "object" }, {});
  bad({ type: "object" }, []);
  ok({ type: "array" }, []);
  bad({ type: "boolean" }, 0);
});

test("enum and const", () => {
  ok({ enum: [1, "a", null, { x: 1 }] }, { x: 1 });
  bad({ enum: [1, 2] }, 3);
  ok({ const: { a: [1, 2] } }, { a: [1, 2] });
  bad({ const: 1 }, "1");
  bad({ const: 1 }, true);
});

test("number bounds", () => {
  ok({ multipleOf: 0.0001 }, 0.0075);
  bad({ multipleOf: 2 }, 7);
  ok({ multipleOf: 2 }, 8);
  ok({ maximum: 3 }, 3);
  bad({ maximum: 3 }, 3.5);
  bad({ exclusiveMaximum: 3 }, 3);
  ok({ exclusiveMaximum: 3 }, 2.99);
  ok({ minimum: 3 }, 3);
  bad({ exclusiveMinimum: 3 }, 3);
});

test("string assertions and unicode length", () => {
  ok({ maxLength: 2 }, "ab");
  bad({ maxLength: 2 }, "abc");
  ok({ minLength: 2 }, "💩💩"); // 2 code points (4 UTF-16 units)
  bad({ maxLength: 1 }, "💩💩");
  ok({ maxLength: 1 }, "💩");
  ok({ pattern: "^a.c$" }, "abc");
  bad({ pattern: "^a.c$" }, "abdc");
});

test("array length, uniqueItems", () => {
  ok({ minItems: 2 }, [1, 2]);
  bad({ minItems: 2 }, [1]);
  bad({ maxItems: 1 }, [1, 2]);
  ok({ uniqueItems: true }, [1, "1", true, { a: 1 }, { a: 2 }]);
  bad({ uniqueItems: true }, [{ a: 1 }, { a: 1 }]);
  ok({ uniqueItems: true }, [1, 2, 3]);
});

test("prefixItems and items", () => {
  const schema = { prefixItems: [{ type: "number" }, { type: "string" }], items: { type: "boolean" } };
  ok(schema, [1, "x"]);
  ok(schema, [1, "x", true, false]);
  bad(schema, [1, "x", 3]);
  bad(schema, ["nope", "x"]);
  ok({ items: { type: "integer" } }, [1, 2, 3]);
  bad({ items: { type: "integer" } }, [1, 2.5]);
});

test("contains / minContains / maxContains", () => {
  ok({ contains: { const: 5 } }, [1, 5, 2]);
  bad({ contains: { const: 5 } }, [1, 2]);
  ok({ contains: { const: 5 }, minContains: 2 }, [5, 5]);
  bad({ contains: { const: 5 }, minContains: 2 }, [5]);
  ok({ contains: { const: 5 }, maxContains: 1 }, [5, 1]);
  bad({ contains: { const: 5 }, maxContains: 1 }, [5, 5]);
  // minContains: 0 makes contains non-asserting on the low end
  ok({ contains: { const: 5 }, minContains: 0 }, [1, 2]);
  ok({ contains: { const: 5 }, minContains: 0 }, []);
  bad({ contains: { const: 5 }, minContains: 0, maxContains: 1 }, [5, 5]);
});

test("object: properties, required, patternProperties, additionalProperties", () => {
  const schema = {
    properties: { a: { type: "number" } },
    patternProperties: { "^x": { type: "string" } },
    additionalProperties: false,
    required: ["a"],
  };
  ok(schema, { a: 1, xy: "s" });
  bad(schema, { a: 1, other: 1 });
  bad(schema, { xy: "s" }); // missing required a
  bad(schema, { a: 1, xy: 5 }); // pattern type fails
  ok({ additionalProperties: { type: "integer" } }, { whatever: 3 });
  bad({ additionalProperties: { type: "integer" } }, { whatever: 3.3 });
});

test("propertyNames", () => {
  ok({ propertyNames: { maxLength: 3 } }, { abc: 1 });
  bad({ propertyNames: { maxLength: 3 } }, { abcd: 1 });
});

test("min/maxProperties", () => {
  ok({ minProperties: 1 }, { a: 1 });
  bad({ minProperties: 2 }, { a: 1 });
  bad({ maxProperties: 1 }, { a: 1, b: 2 });
});

test("dependentRequired and dependentSchemas", () => {
  ok({ dependentRequired: { a: ["b"] } }, { a: 1, b: 2 });
  bad({ dependentRequired: { a: ["b"] } }, { a: 1 });
  ok({ dependentRequired: { a: ["b"] } }, { c: 1 });
  ok({ dependentSchemas: { a: { required: ["b"] } } }, { a: 1, b: 2 });
  bad({ dependentSchemas: { a: { required: ["b"] } } }, { a: 1 });
});

test("allOf / anyOf / oneOf / not", () => {
  ok({ allOf: [{ type: "number" }, { minimum: 0 }] }, 5);
  bad({ allOf: [{ type: "number" }, { minimum: 0 }] }, -1);
  ok({ anyOf: [{ type: "string" }, { type: "number" }] }, 1);
  bad({ anyOf: [{ type: "string" }, { type: "number" }] }, true);
  ok({ oneOf: [{ maximum: 2 }, { minimum: 5 }] }, 1);
  bad({ oneOf: [{ maximum: 10 }, { minimum: 5 }] }, 7); // matches both
  ok({ not: { type: "string" } }, 1);
  bad({ not: { type: "string" } }, "x");
});

test("if/then/else", () => {
  const schema = { if: { type: "number" }, then: { minimum: 10 }, else: { type: "string" } };
  ok(schema, 11);
  bad(schema, 5);
  ok(schema, "hello");
  bad(schema, true);
});

test("unevaluatedProperties across allOf and $ref", () => {
  const schema = {
    allOf: [{ properties: { a: { type: "number" } } }],
    properties: { b: { type: "string" } },
    unevaluatedProperties: false,
  };
  ok(schema, { a: 1, b: "x" });
  bad(schema, { a: 1, b: "x", c: 9 });

  const refSchema = {
    $defs: { base: { properties: { a: {} } } },
    $ref: "#/$defs/base",
    properties: { b: {} },
    unevaluatedProperties: false,
  };
  ok(refSchema, { a: 1, b: 2 });
  bad(refSchema, { a: 1, b: 2, c: 3 });
});

test("unevaluatedProperties with if/then", () => {
  const schema = {
    type: "object",
    if: { properties: { kind: { const: "x" } }, required: ["kind"] },
    then: { properties: { extra: { type: "number" } } },
    unevaluatedProperties: false,
  };
  ok(schema, { kind: "x", extra: 5 });
  bad(schema, { kind: "x", extra: "no" });
  bad(schema, { kind: "x", other: 1 });
});

test("unevaluatedItems across applicators", () => {
  const schema = {
    allOf: [{ prefixItems: [{ type: "number" }] }],
    prefixItems: [{ type: "number" }, { type: "string" }],
    unevaluatedItems: false,
  };
  ok(schema, [1, "x"]);
  bad(schema, [1, "x", true]);

  ok({ prefixItems: [{}], unevaluatedItems: { type: "boolean" } }, [1, true, false]);
  bad({ prefixItems: [{}], unevaluatedItems: { type: "boolean" } }, [1, 2]);
});

test("unevaluatedItems sees contains matches", () => {
  const schema = { contains: { type: "boolean" }, unevaluatedItems: false };
  ok(schema, [true]);
  bad(schema, [true, 1]); // 1 is not contained nor evaluated
});

test("$ref with $defs and JSON pointer", () => {
  const schema = {
    $defs: { pos: { type: "integer", minimum: 0 } },
    properties: { count: { $ref: "#/$defs/pos" } },
  };
  ok(schema, { count: 3 });
  bad(schema, { count: -1 });
});

test("$anchor", () => {
  const schema = {
    $defs: { a: { $anchor: "myAnchor", type: "integer" } },
    $ref: "#myAnchor",
  };
  ok(schema, 5);
  bad(schema, 5.5);
});

test("$id base resolution and remote refs", () => {
  const schema = {
    $id: "https://example.com/root",
    properties: { x: { $ref: "https://example.com/other" } },
  };
  const remotes = { "https://example.com/other": { type: "string" } };
  ok(schema, { x: "hi" }, remotes);
  bad(schema, { x: 1 }, remotes);
});

test("relative remote ref resolution against $id", () => {
  const schema = { $id: "http://localhost:1234/scope/main", $ref: "sibling" };
  const remotes = { "http://localhost:1234/scope/sibling": { type: "integer" } };
  ok(schema, 4, remotes);
  bad(schema, 4.4, remotes);
});

test("$dynamicRef / $dynamicAnchor recursion", () => {
  // Generic tree with a dynamic anchor; an extension overrides it.
  const tree = {
    $id: "https://example.com/tree",
    $dynamicAnchor: "node",
    type: "object",
    properties: {
      data: true,
      children: { type: "array", items: { $dynamicRef: "#node" } },
    },
  };
  const strictTree = {
    $id: "https://example.com/strict-tree",
    $dynamicAnchor: "node",
    $ref: "https://example.com/tree",
    unevaluatedProperties: false,
  };
  const remotes = { "https://example.com/tree": tree };

  // Against the plain tree: extra props allowed.
  ok(tree, { data: 1, children: [{ data: 2, extra: true }] });

  // Against strict tree: unevaluatedProperties:false propagates through recursion.
  ok(strictTree, { data: 1, children: [{ data: 2 }] }, remotes);
  bad(strictTree, { data: 1, children: [{ data: 2, extra: true }] }, remotes);
});

test("$dynamicRef without matching dynamic anchor behaves like $ref", () => {
  const schema = {
    $defs: { x: { $dynamicAnchor: "thing", type: "string" } },
    $dynamicRef: "#thing",
  };
  ok(schema, "hello");
  bad(schema, 1);
});

test("__proto__ etc. are ordinary properties", () => {
  const obj = JSON.parse('{"__proto__": 1, "constructor": 2, "toString": "x"}');
  // Build the schema via JSON.parse so "__proto__" is an own data key, not a prototype set.
  const schema = JSON.parse(JSON.stringify({
    properties: {
      ["__proto__"]: { type: "integer" },
      constructor: { type: "integer" },
      toString: { type: "string" },
    },
    required: ["__proto__", "constructor", "toString"],
    additionalProperties: false,
  }));
  ok(schema, obj);
  const badObj = JSON.parse('{"__proto__": "no", "constructor": 2, "toString": "x"}');
  bad(schema, badObj);
});

test("format is annotation-only (never asserts)", () => {
  ok({ format: "email" }, "not-an-email");
  ok({ format: "date-time", type: "string" }, "whatever");
});

test("absent keywords pass (open by default)", () => {
  ok({}, { anything: [1, 2, 3] });
  ok({ title: "x", description: "y", $comment: "z" }, 42);
});

test("nested $id scopes for refs", () => {
  const schema = {
    $id: "http://example.com/a/",
    properties: {
      foo: {
        $id: "http://example.com/a/foo",
        $ref: "#/$defs/local",
        $defs: { local: { type: "boolean" } },
      },
    },
  };
  ok(schema, { foo: true });
  bad(schema, { foo: 1 });
});

test("unevaluatedProperties: true marks everything evaluated", () => {
  const schema = { properties: { a: {} }, unevaluatedProperties: true };
  ok(schema, { a: 1, b: 2 });
  const schema2 = { properties: { a: {} }, unevaluatedProperties: { type: "number" } };
  ok(schema2, { a: "x", b: 2 });
  bad(schema2, { a: "x", b: "y" });
});

test("unevaluated through anyOf collects all matching branches", () => {
  const schema = {
    anyOf: [{ properties: { a: { type: "number" } } }, { properties: { b: { type: "number" } } }],
    unevaluatedProperties: false,
  };
  ok(schema, { a: 1, b: 2 }); // both branches match -> both props evaluated
  bad(schema, { a: 1, c: 3 });
});

test("minContains:0 still evaluates matched items for unevaluatedItems", () => {
  const schema = { contains: { type: "boolean" }, minContains: 0, unevaluatedItems: false };
  ok(schema, []);
  ok(schema, [true, false]);
  bad(schema, [true, 1]);
});

test("items:true evaluates all items", () => {
  ok({ items: true, unevaluatedItems: false }, [1, 2, "x"]);
});

test("$ref to boolean false schema", () => {
  const schema = { $defs: { no: false }, properties: { x: { $ref: "#/$defs/no" } } };
  bad(schema, { x: 1 });
  ok(schema, {}); // x absent
});

test("$schema and unknown annotations ignored", () => {
  const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "integer", foo: "bar" };
  ok(schema, 3);
  bad(schema, 3.5);
});

test("not does not contribute evaluation annotations", () => {
  const schema = { not: { required: ["x"] }, properties: { a: {} }, unevaluatedProperties: false };
  ok(schema, { a: 1 });
  bad(schema, { a: 1, b: 2 }); // b stays unevaluated, not-schema gives no annotations
});

test("uniqueItems distinguishes types (0 vs false, 1 vs '1')", () => {
  ok({ uniqueItems: true }, [0, false, 1, "1", null, "null"]);
  bad({ uniqueItems: true }, [1, 1.0]);
});

test("recursive ref via #", () => {
  const schema = {
    type: "object",
    properties: { children: { type: "array", items: { $ref: "#" } } },
    required: [],
  };
  ok(schema, { children: [{ children: [] }, {}] });
});
