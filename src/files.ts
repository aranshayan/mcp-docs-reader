import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export class DocError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocError";
  }
}

const within = (root: string, target: string): boolean => {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** Resolves a file/dir path (symlinks followed) and requires it to be inside an allowed root. */
export async function resolveAllowed(input: string, roots: string[]): Promise<string> {
  const realRoots = await Promise.all(roots.map((r) => realpath(r)));
  let abs: string;
  try {
    abs = await realpath(path.isAbsolute(input) ? input : path.resolve(realRoots[0]!, input));
  } catch {
    throw new DocError(`Not found: ${input}`);
  }
  if (!realRoots.some((r) => within(r, abs))) throw new DocError(`Path is outside the allowed folders (${realRoots.join(", ")}).`);
  return abs;
}

export async function readAllowedFile(input: string, roots: string[], exts: string[]): Promise<{ abs: string; data: Buffer }> {
  const abs = await resolveAllowed(input, roots);
  const ext = path.extname(abs).toLowerCase();
  if (!exts.includes(ext)) throw new DocError(`Expected a ${exts.join("/")} file, got "${ext || "no extension"}".`);
  const st = await stat(abs);
  if (!st.isFile()) throw new DocError("Not a file.");
  if (st.size > MAX_FILE_BYTES) throw new DocError(`File is ${Math.round(st.size / 1048576)} MB; the limit is ${MAX_FILE_BYTES / 1048576} MB.`);
  return { abs, data: await readFile(abs) };
}

export const DOC_EXTS = [".pdf", ".docx", ".xlsx", ".csv", ".tsv", ".md", ".txt"];

export async function listDocs(dir: string, recursive: boolean, limit: number): Promise<Array<{ path: string; size: number }>> {
  const out: Array<{ path: string; size: number }> = [];
  async function walk(d: string): Promise<void> {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (out.length >= limit) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory() && recursive) await walk(p);
      else if (e.isFile() && DOC_EXTS.includes(path.extname(e.name).toLowerCase())) out.push({ path: p, size: (await stat(p)).size });
    }
  }
  await walk(dir);
  return out;
}

/** "1-3,5" -> [1,2,3,5] (clamped to pageCount). */
export function parsePages(spec: string | undefined, pageCount: number, maxPages: number): number[] {
  if (!spec) return Array.from({ length: Math.min(pageCount, maxPages) }, (_, i) => i + 1);
  const pages = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!m) throw new DocError(`Invalid page spec "${spec}". Use e.g. "1-3,5".`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let p = Math.max(1, a); p <= Math.min(b, pageCount); p++) pages.add(p);
  }
  return [...pages].sort((x, y) => x - y).slice(0, maxPages);
}
