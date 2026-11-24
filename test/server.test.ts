import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parsePages } from "../src/files.js";
import { createServer } from "../src/server.js";
import { makeDocx, makePdf, makeXlsx } from "./fixtures.js";
import { connect, type Harness } from "./helpers.js";

let base: string, root: string, h: Harness;

beforeAll(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "mcp-docs-")));
  root = join(base, "docs");
  mkdirSync(join(root, "sub"), { recursive: true });
  mkdirSync(join(base, "outside"));
  writeFileSync(join(root, "two.pdf"), makePdf(["Hello first page", "Second page here (with parens)"]));
  writeFileSync(join(root, "blank.pdf"), makePdf([""]));
  writeFileSync(join(root, "bad.pdf"), "not a pdf");
  writeFileSync(join(root, "report.docx"), await makeDocx());
  writeFileSync(join(root, "sales.xlsx"), await makeXlsx());
  writeFileSync(join(root, "people.csv"), "name;age\nAnn;30\nBob;25\n\"Smith; J\";41\n");
  writeFileSync(join(root, "notes.md"), "# Notes\n" + "x".repeat(5000));
  writeFileSync(join(root, "sub", "deep.txt"), "deep");
  writeFileSync(join(base, "outside", "secret.pdf"), makePdf(["secret"]));
  symlinkSync(join(base, "outside"), join(root, "link"));
  h = await connect(createServer([root]));
});
afterAll(async () => {
  await h?.close();
  rmSync(base, { recursive: true, force: true });
});

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await h.call(name, args);
  let json: any = null;
  try { json = JSON.parse(r.text); } catch { /* error text */ }
  return { ...r, json };
};

describe("documents", () => {
  it("exposes five read-only tools", async () => {
    expect(await h.toolNames()).toEqual(["list_documents", "read_docx", "read_pdf", "read_spreadsheet", "read_text"]);
    expect((await h.client.listTools()).tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("lists documents, optionally recursive, skipping symlinked dirs' escape", async () => {
    const flat = (await call("list_documents")).json.files.map((f: any) => f.path.split("/").pop());
    expect(flat).toEqual(expect.arrayContaining(["two.pdf", "report.docx", "sales.xlsx", "people.csv", "notes.md"]));
    expect(flat).not.toContain("deep.txt");
    const deep = (await call("list_documents", { recursive: true })).json.files.map((f: any) => f.path.split("/").pop());
    expect(deep).toContain("deep.txt");
  });

  it("reads PDF pages", async () => {
    const r = (await call("read_pdf", { path: "two.pdf" })).json;
    expect(r.pageCount).toBe(2);
    expect(r.pages.map((p: any) => p.text)).toEqual(["Hello first page", "Second page here (with parens)"]);
    expect((await call("read_pdf", { path: "two.pdf", pages: "2" })).json.pages).toHaveLength(1);
    expect((await call("read_pdf", { path: "blank.pdf" })).json.note).toMatch(/scanned/);
    expect((await call("read_pdf", { path: "bad.pdf" })).text).toMatch(/Could not open PDF/);
    expect((await call("read_pdf", { path: "two.pdf", pages: "x" })).isError).toBe(true);
  });

  it("reads Word documents as markdown and text", async () => {
    const md = (await call("read_docx", { path: "report.docx" })).json;
    expect(md.content).toContain("# Quarterly Report");
    expect(md.content).toContain("**12%**");
    expect((await call("read_docx", { path: "report.docx", format: "text" })).json.content).toContain("Revenue grew 12% this quarter.");
  });

  it("reads spreadsheets with formulas, dates and sheet listing", async () => {
    const r = (await call("read_spreadsheet", { path: "sales.xlsx" })).json;
    expect(r.sheets).toEqual([{ name: "Sales", rows: 4, columns: 3 }, { name: "Notes", rows: 1, columns: 2 }]);
    expect(r.columns).toEqual(["Region", "Units", "Total"]);
    expect(r.rows[0]).toEqual(["North", 10, 20]);
    expect(r.rows[2][2]).toBe("2026-01-02T00:00:00.000Z");
    expect((await call("read_spreadsheet", { path: "sales.xlsx", sheet: "Notes" })).json.totalColumns).toBe(2);
    expect((await call("read_spreadsheet", { path: "sales.xlsx", sheet: "Nope" })).text).toMatch(/Available: Sales, Notes/);
  });

  it("reads CSV with delimiter detection, quotes and paging", async () => {
    const r = (await call("read_spreadsheet", { path: "people.csv", max_rows: 2 })).json;
    expect(r.columns).toEqual(["name", "age"]);
    expect(r.rows).toEqual([["Ann", "30"], ["Bob", "25"]]);
    expect(r.truncated).toBe(true);
    expect((await call("read_spreadsheet", { path: "people.csv", start_row: 2 })).json.rows).toEqual([["Smith; J", "41"]]);
  });

  it("paginates text", async () => {
    const r = (await call("read_text", { path: "notes.md", max_chars: 1000 })).json;
    expect(r.content).toHaveLength(1000);
    expect(r.note).toMatch(/start_index=1000/);
  });
});

describe("security", () => {
  it("blocks traversal, absolute paths, symlink escapes and wrong types", async () => {
    for (const p of ["../outside/secret.pdf", join(base, "outside", "secret.pdf"), "link/secret.pdf", "/etc/passwd"]) {
      const r = await call("read_pdf", { path: p });
      expect(r.isError, p).toBe(true);
    }
    expect((await call("read_pdf", { path: "people.csv" })).text).toMatch(/Expected a \.pdf/);
    expect((await call("list_documents", { dir: ".." })).text).toMatch(/outside the allowed/);
  });
});

describe("parsePages", () => {
  it("parses specs and clamps", () => {
    expect(parsePages("1-3,5", 4, 50)).toEqual([1, 2, 3]);
    expect(parsePages(undefined, 100, 20)).toHaveLength(20);
    expect(parsePages("2-9", 3, 50)).toEqual([2, 3]);
  });
});
