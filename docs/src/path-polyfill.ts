// Minimal node:path polyfill for browser compatibility.
// fumadocs-mdx/runtime/server uses path.join and fumadocs-core/source uses path.dirname.
// Neither raw file reads are performed in the browser, so path values are only used
// as keys — the POSIX-style implementations below are sufficient.

function join(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function dirname(p: string): string {
  if (!p) return ".";
  const idx = p.lastIndexOf("/");
  if (idx === -1) return ".";
  if (idx === 0) return "/";
  return p.slice(0, idx);
}

function basename(p: string, ext?: string): string {
  let base = p.slice(p.lastIndexOf("/") + 1);
  if (ext && base.endsWith(ext)) base = base.slice(0, -ext.length);
  return base;
}

function extname(p: string): string {
  const base = p.slice(p.lastIndexOf("/") + 1);
  const idx = base.lastIndexOf(".");
  return idx === -1 ? "" : base.slice(idx);
}

function resolve(...paths: string[]): string {
  return join(...paths);
}

function normalize(p: string): string {
  return p.replace(/\/+/g, "/");
}

function relative(_from: string, to: string): string {
  return to;
}

const posix = {
  join,
  dirname,
  basename,
  extname,
  resolve,
  normalize,
  relative,
  sep: "/",
};

export {
  join,
  dirname,
  basename,
  extname,
  resolve,
  normalize,
  relative,
  posix,
};

export default {
  join,
  dirname,
  basename,
  extname,
  resolve,
  normalize,
  relative,
  posix,
  sep: "/",
};
