# mcp-docs-reader

[![CI](https://github.com/aranshayan/mcp-docs-reader/actions/workflows/ci.yml/badge.svg)](https://github.com/aranshayan/mcp-docs-reader/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@aranshayan/mcp-docs-reader)](https://www.npmjs.com/package/@aranshayan/mcp-docs-reader)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An [MCP](https://modelcontextprotocol.io) server that lets Claude **read your PDFs, Word documents, spreadsheets and CSVs** as clean text, Markdown and tables.

- **PDF** — text per page, page ranges (`"1-3,5"`), title metadata.
- **Word (.docx)** — Markdown with headings, lists, bold, tables and links, or plain text.
- **Excel (.xlsx) / CSV / TSV** — sheet listing, header + rows with paging, cached formula results, ISO dates, automatic CSV delimiter detection.
- **Sandboxed.** Only folders passed with `--root` are readable; symlinks are resolved first, so a link pointing outside is refused. 25 MB file limit. Read-only.
- Pure JavaScript, no native dependencies, no network access. Node.js 22+.

## Quick start

```json
{
  "mcpServers": {
    "docs": { "command": "npx", "args": ["-y", "@aranshayan/mcp-docs-reader", "--root", "/path/to/Documents"] }
  }
}
```

Claude Code: `claude mcp add docs -- npx -y @aranshayan/mcp-docs-reader --root "$HOME/Documents"`. Multiple `--root` flags (or `MCP_DOCS_ROOTS`) are allowed; the default is the current directory.

## Tools

| Tool | Description |
| --- | --- |
| `list_documents` | PDF/DOCX/XLSX/CSV/MD/TXT files in a folder (optionally recursive). |
| `read_pdf` | Text by page; `pages`, `max_chars`. |
| `read_docx` | Markdown or text; paginated with `start_index`. |
| `read_spreadsheet` | `.xlsx` (with `sheet`) or `.csv`/`.tsv`; `start_row`, `max_rows` (≤500). |
| `read_text` | `.md` / `.txt`, paginated. |

All tools are `readOnlyHint`. Document contents are untrusted: a document can contain text that tries to instruct the model.

## Limits

- **No OCR.** Scanned PDFs return empty pages with an explanatory note.
- Images in Word documents are dropped; charts and pivot tables are not interpreted.
- Legacy `.doc` / `.xls` are not supported.
- `exceljs` depends on `uuid` 8.x, which has a moderate advisory about a `buf` argument that exceljs does not use. Consumers cannot override this from a dependency; it is not reachable here.

## Tests

`npm test` generates real PDF, DOCX and XLSX fixtures and checks every tool, path traversal, absolute paths, symlink escape, wrong file types, corrupt files, and the built CLI over stdio.

## License

[MIT](LICENSE)
