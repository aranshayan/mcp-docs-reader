import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import mammoth from "mammoth";
import TurndownService from "turndown";
import { DocError } from "./files.js";

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });

export async function pdfPages(data: Buffer, pages: (count: number) => number[]): Promise<{ pageCount: number; title: string | null; pages: Array<{ page: number; text: string }> }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, verbosity: 0 });
  const doc = await task.promise.catch((e: Error) => {
    throw new DocError(`Could not open PDF: ${e.message}`);
  });
  try {
    const meta = (await doc.getMetadata().catch(() => null)) as { info?: { Title?: string } } | null;
    const out: Array<{ page: number; text: string }> = [];
    for (const n of pages(doc.numPages)) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
      }
      out.push({ page: n, text: text.replace(/[ \t]+\n/g, "\n").replace(/[ ]{2,}/g, " ").trim() });
    }
    return { pageCount: doc.numPages, title: meta?.info?.Title?.trim() || null, pages: out };
  } finally {
    await task.destroy();
  }
}

export async function docx(data: Buffer, format: "markdown" | "text"): Promise<{ content: string; warnings: string[] }> {
  try {
    if (format === "text") {
      const r = await mammoth.extractRawText({ buffer: data });
      return { content: r.value.trim(), warnings: r.messages.map((m) => m.message).slice(0, 5) };
    }
    const r = await mammoth.convertToHtml({ buffer: data }, { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) });
    return { content: turndown.turndown(r.value.replace(/<img[^>]*>/g, "")).trim(), warnings: r.messages.map((m) => m.message).slice(0, 5) };
  } catch (e) {
    throw new DocError(`Could not read .docx: ${(e as Error).message}`);
  }
}

export interface Table {
  sheet: string;
  totalRows: number;
  totalColumns: number;
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("result" in v) return cellValue((v as { result: ExcelJS.CellValue }).result);
    if ("richText" in v) return (v as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join("");
    if ("text" in v) return (v as { text: string }).text;
    if ("error" in v) return String((v as { error: string }).error);
    return JSON.stringify(v);
  }
  return v;
}

export async function xlsxSheets(data: Buffer): Promise<Array<{ name: string; rows: number; columns: number }>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as never).catch((e: Error) => {
    throw new DocError(`Could not read .xlsx: ${e.message}`);
  });
  return wb.worksheets.map((s) => ({ name: s.name, rows: s.actualRowCount, columns: s.actualColumnCount }));
}

export async function xlsxTable(data: Buffer, sheet: string | undefined, startRow: number, maxRows: number): Promise<Table> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as never).catch((e: Error) => {
    throw new DocError(`Could not read .xlsx: ${e.message}`);
  });
  const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0];
  if (!ws) throw new DocError(`Sheet "${sheet}" not found. Available: ${wb.worksheets.map((s) => s.name).join(", ")}.`);
  const width = ws.actualColumnCount;
  const all: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    all.push(Array.from({ length: width }, (_, i) => cellValue(row.getCell(i + 1).value)));
  });
  const [header = [], ...body] = all;
  const slice = body.slice(startRow, startRow + maxRows);
  return {
    sheet: ws.name,
    totalRows: body.length,
    totalColumns: width,
    columns: header.map((h, i) => (h === null ? `col${i + 1}` : String(h))),
    rows: slice,
    truncated: startRow + slice.length < body.length,
  };
}

export function csvTable(data: Buffer, startRow: number, maxRows: number, delimiter?: string): Table {
  const text = data.toString("utf8").replace(/^﻿/, "");
  const firstLine = text.split("\n", 1)[0] ?? "";
  const delim = delimiter ?? ([",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0]);
  let records: string[][];
  try {
    records = parseCsv(text, { delimiter: delim, relax_column_count: true, skip_empty_lines: true, relax_quotes: true });
  } catch (e) {
    throw new DocError(`Could not parse CSV: ${(e as Error).message}`);
  }
  const [header = [], ...body] = records;
  const slice = body.slice(startRow, startRow + maxRows);
  return { sheet: "csv", totalRows: body.length, totalColumns: header.length, columns: header, rows: slice, truncated: startRow + slice.length < body.length };
}
