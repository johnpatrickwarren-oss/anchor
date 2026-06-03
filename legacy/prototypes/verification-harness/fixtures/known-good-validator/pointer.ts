// RFC 6901 JSON Pointer evaluation against an in-memory document.

import { ownValue } from "./util.ts";

/**
 * Resolve a JSON Pointer fragment (e.g. "/$defs/foo/0") against `root`.
 * The leading "#" must already be stripped; `pointer` starts with "/".
 * Returns undefined if any token is missing.
 */
export function getByPointer(root: unknown, pointer: string): unknown {
  let p = pointer;
  try {
    p = decodeURIComponent(pointer);
  } catch {
    // leave as-is on malformed escapes
  }
  if (p === "") return root;
  const parts = p.split("/").slice(1);
  let cur: unknown = root;
  for (let part of parts) {
    part = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9][0-9]*)$/.test(part)) return undefined;
      const idx = Number(part);
      if (idx >= cur.length) return undefined;
      cur = cur[idx];
    } else if (typeof cur === "object") {
      if (!Object.hasOwn(cur, part)) return undefined;
      cur = ownValue(cur, part);
    } else {
      return undefined;
    }
  }
  return cur;
}
