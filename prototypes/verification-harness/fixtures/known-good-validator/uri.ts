// Minimal RFC 3986 URI reference resolution (Section 5) — enough for $id/$ref
// base resolution. Dependency-free.

interface Parts {
  scheme?: string;
  authority?: string;
  path: string;
  query?: string;
  fragment?: string;
}

const URI_RE =
  /^(?:([^:/?#]+):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/;

export function parseUri(uri: string): Parts {
  const m = URI_RE.exec(uri);
  if (!m) return { path: uri };
  return {
    scheme: m[1],
    authority: m[2],
    path: m[3] ?? "",
    query: m[4],
    fragment: m[5],
  };
}

function removeDotSegments(path: string): string {
  const out: string[] = [];
  let input = path;
  while (input.length > 0) {
    if (input.startsWith("../")) {
      input = input.slice(3);
    } else if (input.startsWith("./")) {
      input = input.slice(2);
    } else if (input === "/." || input.startsWith("/./")) {
      input = "/" + input.slice(input === "/." ? 2 : 3);
    } else if (input === "/.." || input.startsWith("/../")) {
      input = "/" + input.slice(input === "/.." ? 3 : 4);
      out.pop();
    } else if (input === "." || input === "..") {
      input = "";
    } else {
      let i = input.startsWith("/") ? 1 : 0;
      const next = input.indexOf("/", i);
      const seg = next === -1 ? input : input.slice(0, next);
      out.push(seg);
      input = next === -1 ? "" : input.slice(next);
    }
  }
  return out.join("");
}

function merge(base: Parts, refPath: string): string {
  if (base.authority !== undefined && base.path === "") {
    return "/" + refPath;
  }
  const i = base.path.lastIndexOf("/");
  if (i === -1) return refPath;
  return base.path.slice(0, i + 1) + refPath;
}

function recompose(p: Parts): string {
  let result = "";
  if (p.scheme !== undefined) result += p.scheme + ":";
  if (p.authority !== undefined) result += "//" + p.authority;
  result += p.path;
  if (p.query !== undefined) result += "?" + p.query;
  if (p.fragment !== undefined) result += "#" + p.fragment;
  return result;
}

/** Resolve `ref` against `base` per RFC 3986 §5.2. Returns an absolute (or as-absolute-as-possible) URI. */
export function resolveUri(base: string, ref: string): string {
  const b = parseUri(base);
  const r = parseUri(ref);
  let scheme: string | undefined;
  let authority: string | undefined;
  let path: string;
  let query: string | undefined;

  if (r.scheme !== undefined) {
    scheme = r.scheme;
    authority = r.authority;
    path = removeDotSegments(r.path);
    query = r.query;
  } else {
    if (r.authority !== undefined) {
      authority = r.authority;
      path = removeDotSegments(r.path);
      query = r.query;
    } else {
      if (r.path === "") {
        path = b.path;
        query = r.query !== undefined ? r.query : b.query;
      } else {
        if (r.path.startsWith("/")) {
          path = removeDotSegments(r.path);
        } else {
          path = removeDotSegments(merge(b, r.path));
        }
        query = r.query;
      }
      authority = b.authority;
    }
    scheme = b.scheme;
  }

  return recompose({ scheme, authority, path, query, fragment: r.fragment });
}

/** Split an absolute URI into [uriWithoutFragment, fragment | undefined]. */
export function splitFragment(uri: string): [string, string | undefined] {
  const i = uri.indexOf("#");
  if (i < 0) return [uri, undefined];
  return [uri.slice(0, i), uri.slice(i + 1)];
}

export function stripFragment(uri: string): string {
  return splitFragment(uri)[0];
}
