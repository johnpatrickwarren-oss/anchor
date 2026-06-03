// Schema registry: walks schema documents to record $id base URIs, $anchor and
// $dynamicAnchor locations, and resolves $ref / $dynamicRef targets.

import { resolveUri, splitFragment, stripFragment } from "./uri.ts";
import { getByPointer } from "./pointer.ts";

export type Schema = boolean | Record<string, unknown>;

export interface Resolved {
  node: Schema;
  base: string;
}

// Keywords whose value is a single subschema.
const SUBSCHEMA = [
  "items",
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
];
// Keywords whose value is an array of subschemas.
const SUBSCHEMA_ARRAY = ["allOf", "anyOf", "oneOf", "prefixItems"];
// Keywords whose value is a map of subschemas.
const SUBSCHEMA_MAP = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
];

export class Registry {
  byId = new Map<string, Schema>(); // base URI (no fragment) -> resource root
  anchors = new Map<string, Schema>(); // "base#anchor" -> node
  dynamicAnchors = new Map<string, Schema>(); // "base#anchor" -> node
  nodeBase = new Map<object, string>(); // node identity -> base URI
  private remotes: Record<string, unknown>;

  constructor(remotes?: Record<string, unknown>) {
    this.remotes = remotes ?? {};
    for (const [uri, schema] of Object.entries(this.remotes)) {
      const base = stripFragment(uri);
      if (!this.byId.has(base)) this.byId.set(base, schema as Schema);
      this.walk(schema, base);
    }
  }

  register(root: unknown): string {
    this.walk(root, "");
    if (root && typeof root === "object" && !Array.isArray(root)) {
      const base = this.nodeBase.get(root as object) ?? "";
      // Ensure the root document is addressable even without an explicit $id.
      if (!this.byId.has(base)) this.byId.set(base, root as Schema);
      return base;
    }
    return "";
  }

  private walk(node: unknown, baseURI: string): void {
    if (typeof node !== "object" || node === null) return;
    if (Array.isArray(node)) return;
    const obj = node as Record<string, unknown>;

    let base = baseURI;
    if (typeof obj.$id === "string") {
      base = stripFragment(resolveUri(baseURI, obj.$id));
      this.byId.set(base, obj);
    }
    this.nodeBase.set(obj, base);

    if (typeof obj.$anchor === "string") {
      this.anchors.set(base + "#" + obj.$anchor, obj);
    }
    if (typeof obj.$dynamicAnchor === "string") {
      this.dynamicAnchors.set(base + "#" + obj.$dynamicAnchor, obj);
      // A $dynamicAnchor is also reachable as an ordinary $anchor.
      if (!this.anchors.has(base + "#" + obj.$dynamicAnchor)) {
        this.anchors.set(base + "#" + obj.$dynamicAnchor, obj);
      }
    }

    for (const kw of SUBSCHEMA) {
      if (kw in obj) this.walk(obj[kw], base);
    }
    for (const kw of SUBSCHEMA_ARRAY) {
      const v = obj[kw];
      if (Array.isArray(v)) for (const s of v) this.walk(s, base);
    }
    for (const kw of SUBSCHEMA_MAP) {
      const v = obj[kw];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const k of Object.keys(v)) this.walk((v as Record<string, unknown>)[k], base);
      }
    }
  }

  private rememberBase(node: Schema, base: string): void {
    if (node && typeof node === "object" && !this.nodeBase.has(node)) {
      this.nodeBase.set(node, base);
    }
  }

  /** Resolve a plain $ref string from the given base URI. */
  resolveRef(ref: string, baseURI: string): Resolved | undefined {
    const abs = resolveUri(baseURI, ref);
    const [uriNoFrag, frag] = splitFragment(abs);
    const root = this.byId.get(uriNoFrag);

    if (frag === undefined || frag === "") {
      if (root === undefined) return undefined;
      const base = this.nodeBase.get(root as object) ?? uriNoFrag;
      this.rememberBase(root, base);
      return { node: root, base };
    }

    if (frag.startsWith("/")) {
      if (root === undefined) return undefined;
      const node = getByPointer(root, frag);
      if (node === undefined || (typeof node !== "object" && typeof node !== "boolean")) {
        return undefined;
      }
      const sNode = node as Schema;
      const base =
        (typeof sNode === "object" && this.nodeBase.get(sNode)) ||
        this.nodeBase.get(root as object) ||
        uriNoFrag;
      this.rememberBase(sNode, base);
      return { node: sNode, base };
    }

    // plain-name anchor
    let name = frag;
    try {
      name = decodeURIComponent(frag);
    } catch {
      /* keep raw */
    }
    const node = this.anchors.get(uriNoFrag + "#" + name);
    if (node === undefined) return undefined;
    const base = this.nodeBase.get(node as object) ?? uriNoFrag;
    this.rememberBase(node, base);
    return { node, base };
  }
}
