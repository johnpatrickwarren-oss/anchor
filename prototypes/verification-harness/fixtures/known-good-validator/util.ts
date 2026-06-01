// JSON-level helpers shared across the validator. All instance access goes
// through ownValue/ownKeys so that data keys like __proto__ / constructor are
// treated as ordinary properties (never prototype lookups).

export type Json = unknown;

/** Read an own data property without triggering inherited accessors (e.g. __proto__). */
export function ownValue(obj: object, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  if (!d) return undefined;
  return "value" in d ? d.value : undefined;
}

/** Own enumerable string keys. */
export function ownKeys(obj: object): string[] {
  return Object.keys(obj);
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The JSON type name of a value. */
export function jsonType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "object") return "object";
  if (t === "boolean") return "boolean";
  if (t === "string") return "string";
  if (t === "number") return "number";
  return "unknown";
}

/** Whether a value satisfies a single JSON Schema `type` token. */
export function matchesType(v: unknown, type: string): boolean {
  if (type === "integer") {
    return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v);
  }
  if (type === "number") {
    return typeof v === "number" && Number.isFinite(v);
  }
  return jsonType(v) === type;
}

/** Length in Unicode code points (not UTF-16 units). */
export function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Deep equality with JSON semantics (object key order irrelevant, arrays ordered). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) {
    // numbers vs other handled by ===; differing typeof never equal
    return false;
  }
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return a === b;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr) {
    const aa = a as unknown[];
    const bb = b as unknown[];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
      if (!deepEqual(aa[i], bb[i])) return false;
    }
    return true;
  }
  const ao = a as object;
  const bo = b as object;
  const ak = ownKeys(ao);
  const bk = ownKeys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.hasOwn(bo, k)) return false;
    if (!deepEqual(ownValue(ao, k), ownValue(bo, k))) return false;
  }
  return true;
}

/** Robust multipleOf supporting floats. */
export function isMultipleOf(n: number, m: number): boolean {
  if (m === 0) return false;
  if (!Number.isFinite(n) || !Number.isFinite(m)) return false;
  const ratio = n / m;
  if (Number.isInteger(ratio)) return true;
  const rounded = Math.round(ratio);
  // Relative tolerance to absorb binary-float representation error.
  const eps = Math.max(Math.abs(ratio), 1) * Number.EPSILON * 8;
  return Math.abs(ratio - rounded) <= eps;
}
