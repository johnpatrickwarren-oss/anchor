// Core JSON Schema draft 2020-12 evaluation with annotation propagation for
// unevaluatedProperties / unevaluatedItems and dynamic-scope $dynamicRef.

import { Registry, type Schema } from "./registry.ts";
import { resolveUri, splitFragment } from "./uri.ts";
import {
  codePointLength,
  deepEqual,
  isMultipleOf,
  isPlainObject,
  jsonType,
  matchesType,
  ownKeys,
  ownValue,
} from "./util.ts";

interface Ctx {
  registry: Registry;
  baseURI: string;
  dynamicScope: string[];
  errors: ValidationError[];
}

export interface ValidationError {
  keyword: string;
  message: string;
  instancePath: string;
}

interface Out {
  valid: boolean;
  props: Set<string>;
  items: Set<number>;
}

function ok(): Out {
  return { valid: true, props: new Set(), items: new Set() };
}

const regexCache = new Map<string, RegExp | null>();
function compileRegex(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern)!;
  let re: RegExp | null;
  try {
    re = new RegExp(pattern, "u");
  } catch {
    try {
      re = new RegExp(pattern);
    } catch {
      re = null;
    }
  }
  regexCache.set(pattern, re);
  return re;
}

export function validateSchema(
  schema: Schema,
  instance: unknown,
  ctx: Ctx,
  instancePath: string,
): Out {
  if (schema === true) return ok();
  if (schema === false) {
    ctx.errors.push({ keyword: "false", message: "schema is false", instancePath });
    return { valid: false, props: new Set(), items: new Set() };
  }
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    // Not a valid schema position; treat as permissive.
    return ok();
  }

  const s = schema as Record<string, unknown>;
  const props = new Set<string>();
  const items = new Set<number>();
  let valid = true;
  const error = (keyword: string, message: string) => {
    valid = false;
    ctx.errors.push({ keyword, message, instancePath });
  };
  const mergeIn = (out: Out) => {
    for (const p of out.props) props.add(p);
    for (const i of out.items) items.add(i);
  };

  // Enter resource / dynamic scope if this node introduces a new base URI.
  const base = ctx.registry.nodeBase.get(schema) ?? ctx.baseURI;
  const prevBase = ctx.baseURI;
  let pushed = false;
  if (base !== ctx.baseURI) {
    ctx.baseURI = base;
    ctx.dynamicScope.push(base);
    pushed = true;
  }

  try {
    const t = jsonType(instance);
    const isObj = t === "object";
    const isArr = t === "array";
    const isNum = typeof instance === "number" && Number.isFinite(instance);
    const isStr = t === "string";

    // ---- $ref (applies alongside siblings in 2020-12) ----
    if (typeof s.$ref === "string") {
      const target = ctx.registry.resolveRef(s.$ref, ctx.baseURI);
      if (!target) {
        error("$ref", `cannot resolve $ref ${s.$ref}`);
      } else {
        const out = validateSchema(target.node, instance, ctx, instancePath);
        if (!out.valid) valid = false;
        mergeIn(out);
      }
    }

    // ---- $dynamicRef ----
    if (typeof s.$dynamicRef === "string") {
      const out = resolveDynamic(s.$dynamicRef, instance, ctx, instancePath);
      if (out === undefined) {
        error("$dynamicRef", `cannot resolve $dynamicRef ${s.$dynamicRef}`);
      } else {
        if (!out.valid) valid = false;
        mergeIn(out);
      }
    }

    // ---- type ----
    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((ty) => typeof ty === "string" && matchesType(instance, ty))) {
        error("type", `expected ${types.join(",")}, got ${t}`);
      }
    }

    // ---- enum ----
    if (Array.isArray(s.enum)) {
      if (!s.enum.some((e) => deepEqual(e, instance))) {
        error("enum", "value not in enum");
      }
    }

    // ---- const ----
    if ("const" in s) {
      if (!deepEqual(s.const, instance)) error("const", "value not equal to const");
    }

    // ---- number assertions ----
    if (isNum) {
      const n = instance as number;
      if (typeof s.multipleOf === "number" && !isMultipleOf(n, s.multipleOf)) {
        error("multipleOf", `not a multiple of ${s.multipleOf}`);
      }
      if (typeof s.maximum === "number" && n > s.maximum) {
        error("maximum", `> maximum ${s.maximum}`);
      }
      if (typeof s.exclusiveMaximum === "number" && n >= s.exclusiveMaximum) {
        error("exclusiveMaximum", `>= exclusiveMaximum ${s.exclusiveMaximum}`);
      }
      if (typeof s.minimum === "number" && n < s.minimum) {
        error("minimum", `< minimum ${s.minimum}`);
      }
      if (typeof s.exclusiveMinimum === "number" && n <= s.exclusiveMinimum) {
        error("exclusiveMinimum", `<= exclusiveMinimum ${s.exclusiveMinimum}`);
      }
    }

    // ---- string assertions ----
    if (isStr) {
      const str = instance as string;
      let len = -1;
      if (typeof s.maxLength === "number") {
        len = codePointLength(str);
        if (len > s.maxLength) error("maxLength", "too long");
      }
      if (typeof s.minLength === "number") {
        if (len < 0) len = codePointLength(str);
        if (len < s.minLength) error("minLength", "too short");
      }
      if (typeof s.pattern === "string") {
        const re = compileRegex(s.pattern);
        if (re && !re.test(str)) error("pattern", `does not match ${s.pattern}`);
      }
    }

    // ---- array assertions & applicators ----
    if (isArr) {
      const arr = instance as unknown[];

      let prefixLen = 0;
      if (Array.isArray(s.prefixItems)) {
        const pi = s.prefixItems as Schema[];
        const lim = Math.min(pi.length, arr.length);
        for (let i = 0; i < lim; i++) {
          const out = validateSchema(pi[i], arr[i], ctx, `${instancePath}/${i}`);
          if (out.valid) items.add(i);
          else valid = false;
        }
        prefixLen = pi.length;
      }

      if ("items" in s) {
        for (let i = prefixLen; i < arr.length; i++) {
          const out = validateSchema(s.items as Schema, arr[i], ctx, `${instancePath}/${i}`);
          if (out.valid) items.add(i);
          else valid = false;
        }
      }

      if ("contains" in s) {
        const min = typeof s.minContains === "number" ? s.minContains : 1;
        const max = typeof s.maxContains === "number" ? s.maxContains : Infinity;
        let count = 0;
        for (let i = 0; i < arr.length; i++) {
          const out = validateSchema(s.contains as Schema, arr[i], ctx, `${instancePath}/${i}`);
          if (out.valid) {
            count++;
            items.add(i);
          }
        }
        if (count < min) error("contains", `matched ${count} < minContains ${min}`);
        if (count > max) error("maxContains", `matched ${count} > maxContains ${max}`);
      }

      if (typeof s.minItems === "number" && arr.length < s.minItems) {
        error("minItems", "too few items");
      }
      if (typeof s.maxItems === "number" && arr.length > s.maxItems) {
        error("maxItems", "too many items");
      }
      if (s.uniqueItems === true) {
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            if (deepEqual(arr[i], arr[j])) {
              error("uniqueItems", `items ${i} and ${j} are equal`);
              i = arr.length; // break outer
              break;
            }
          }
        }
      }
    }

    // ---- object assertions & applicators ----
    if (isObj) {
      const obj = instance as Record<string, unknown>;
      const keys = ownKeys(obj);

      if (typeof s.maxProperties === "number" && keys.length > s.maxProperties) {
        error("maxProperties", "too many properties");
      }
      if (typeof s.minProperties === "number" && keys.length < s.minProperties) {
        error("minProperties", "too few properties");
      }
      if (Array.isArray(s.required)) {
        for (const r of s.required) {
          if (typeof r === "string" && !Object.hasOwn(obj, r)) {
            error("required", `missing required property ${r}`);
          }
        }
      }
      if (isPlainObject(s.dependentRequired)) {
        for (const key of Object.keys(s.dependentRequired)) {
          if (!Object.hasOwn(obj, key)) continue;
          const reqs = (s.dependentRequired as Record<string, unknown>)[key];
          if (Array.isArray(reqs)) {
            for (const r of reqs) {
              if (typeof r === "string" && !Object.hasOwn(obj, r)) {
                error("dependentRequired", `${key} requires ${r}`);
              }
            }
          }
        }
      }

      const propsSchema = isPlainObject(s.properties) ? (s.properties as Record<string, Schema>) : undefined;
      const patternSchema = isPlainObject(s.patternProperties)
        ? (s.patternProperties as Record<string, Schema>)
        : undefined;

      if (propsSchema) {
        for (const key of Object.keys(propsSchema)) {
          if (Object.hasOwn(obj, key)) {
            const out = validateSchema(
              ownValue(propsSchema, key) as Schema,
              ownValue(obj, key),
              ctx,
              `${instancePath}/${key}`,
            );
            if (out.valid) props.add(key);
            else valid = false;
          }
        }
      }

      if (patternSchema) {
        const compiled = Object.keys(patternSchema).map(
          (p) => [compileRegex(p), ownValue(patternSchema, p) as Schema] as const,
        );
        for (const key of keys) {
          for (const [re, sub] of compiled) {
            if (re && re.test(key)) {
              const out = validateSchema(sub, ownValue(obj, key), ctx, `${instancePath}/${key}`);
              if (out.valid) props.add(key);
              else valid = false;
            }
          }
        }
      }

      if ("additionalProperties" in s) {
        const compiledPat = patternSchema
          ? Object.keys(patternSchema).map((p) => compileRegex(p))
          : [];
        for (const key of keys) {
          if (propsSchema && Object.hasOwn(propsSchema, key)) continue;
          if (compiledPat.some((re) => re && re.test(key))) continue;
          const out = validateSchema(
            s.additionalProperties as Schema,
            ownValue(obj, key),
            ctx,
            `${instancePath}/${key}`,
          );
          if (out.valid) props.add(key);
          else valid = false;
        }
      }

      if ("propertyNames" in s) {
        for (const key of keys) {
          const out = validateSchema(s.propertyNames as Schema, key, ctx, `${instancePath}/${key}`);
          if (!out.valid) valid = false;
        }
      }

      if (isPlainObject(s.dependentSchemas)) {
        for (const key of Object.keys(s.dependentSchemas)) {
          if (!Object.hasOwn(obj, key)) continue;
          const out = validateSchema(
            ownValue(s.dependentSchemas, key) as Schema,
            instance,
            ctx,
            instancePath,
          );
          if (!out.valid) valid = false;
          else mergeIn(out);
        }
      }
    }

    // ---- in-place applicators (any instance type) ----
    if (Array.isArray(s.allOf)) {
      for (const sub of s.allOf as Schema[]) {
        const out = validateSchema(sub, instance, ctx, instancePath);
        if (!out.valid) valid = false;
        else mergeIn(out);
      }
    }
    if (Array.isArray(s.anyOf)) {
      let any = false;
      for (const sub of s.anyOf as Schema[]) {
        const out = validateSchema(sub, instance, ctx, instancePath);
        if (out.valid) {
          any = true;
          mergeIn(out);
        }
      }
      if (!any) error("anyOf", "no anyOf branch matched");
    }
    if (Array.isArray(s.oneOf)) {
      let matched = 0;
      let matchedOut: Out | undefined;
      for (const sub of s.oneOf as Schema[]) {
        const out = validateSchema(sub, instance, ctx, instancePath);
        if (out.valid) {
          matched++;
          matchedOut = out;
        }
      }
      if (matched !== 1) error("oneOf", `${matched} oneOf branches matched`);
      else if (matchedOut) mergeIn(matchedOut);
    }
    if ("not" in s) {
      const out = validateSchema(s.not as Schema, instance, ctx, instancePath);
      if (out.valid) error("not", "instance matched 'not' schema");
    }
    if ("if" in s) {
      const c = validateSchema(s.if as Schema, instance, ctx, instancePath);
      if (c.valid) {
        mergeIn(c);
        if ("then" in s) {
          const out = validateSchema(s.then as Schema, instance, ctx, instancePath);
          if (!out.valid) valid = false;
          else mergeIn(out);
        }
      } else if ("else" in s) {
        const out = validateSchema(s.else as Schema, instance, ctx, instancePath);
        if (!out.valid) valid = false;
        else mergeIn(out);
      }
    }

    // ---- unevaluated* (must see annotations from everything above) ----
    if (isObj && "unevaluatedProperties" in s) {
      const obj = instance as Record<string, unknown>;
      for (const key of ownKeys(obj)) {
        if (props.has(key)) continue;
        const out = validateSchema(
          s.unevaluatedProperties as Schema,
          ownValue(obj, key),
          ctx,
          `${instancePath}/${key}`,
        );
        if (out.valid) props.add(key);
        else valid = false;
      }
    }
    if (isArr && "unevaluatedItems" in s) {
      const arr = instance as unknown[];
      for (let i = 0; i < arr.length; i++) {
        if (items.has(i)) continue;
        const out = validateSchema(s.unevaluatedItems as Schema, arr[i], ctx, `${instancePath}/${i}`);
        if (out.valid) items.add(i);
        else valid = false;
      }
    }
  } finally {
    if (pushed) {
      ctx.dynamicScope.pop();
      ctx.baseURI = prevBase;
    }
  }

  return { valid, props, items };
}

function resolveDynamic(
  ref: string,
  instance: unknown,
  ctx: Ctx,
  instancePath: string,
): Out | undefined {
  const abs = resolveUri(ctx.baseURI, ref);
  const [, frag] = splitFragment(abs);

  const lex = ctx.registry.resolveRef(ref, ctx.baseURI);

  // Dynamic behavior only when the fragment is a plain anchor name AND the
  // lexically-resolved target itself carries a matching $dynamicAnchor.
  if (frag !== undefined && frag !== "" && !frag.startsWith("/") && lex) {
    let name = frag;
    try {
      name = decodeURIComponent(frag);
    } catch {
      /* keep */
    }
    const lexBase =
      (typeof lex.node === "object" && ctx.registry.nodeBase.get(lex.node)) || lex.base;
    if (ctx.registry.dynamicAnchors.get(lexBase + "#" + name) === lex.node) {
      // Search dynamic scope from outermost inward for the anchor.
      for (const sb of ctx.dynamicScope) {
        const cand = ctx.registry.dynamicAnchors.get(sb + "#" + name);
        if (cand !== undefined) {
          return validateSchema(cand, instance, ctx, instancePath);
        }
      }
    }
  }

  if (!lex) return undefined;
  return validateSchema(lex.node, instance, ctx, instancePath);
}
