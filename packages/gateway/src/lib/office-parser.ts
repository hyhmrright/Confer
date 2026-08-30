// Text extraction for the two OOXML formats: .docx and .xlsx.
//
// Both are zip archives of XML, so both go through a library rather than any
// hand-rolled unpacking. Kept out of `doc-parser.ts` so that file stays a
// content-type dispatcher; everything here is about turning one office format
// into text a retriever can actually match against.
//
// The shared goal is that structure survives. A spreadsheet or a document table
// flattened into a column of loose cells ("地区 / 营收 / 华东 / 1200") loses the
// row-column relation that carried the meaning, and no amount of chunking or
// reranking downstream can put it back. Both extractors therefore emit Markdown
// tables, which chunk cleanly and which every model reads natively.

import { createRequire } from 'node:module';

// Both libraries ship CJS only, same as pdf-parse in doc-parser.ts.
const require_ = createRequire(import.meta.url);

interface MammothResult {
  value: string;
}
const mammoth = require_('mammoth') as {
  convertToHtml(input: { buffer: Buffer }): Promise<MammothResult>;
};

interface ExcelCellRich {
  richText: Array<{ text?: string }>;
}
interface ExcelCellFormula {
  formula: string;
  result?: unknown;
}
interface ExcelCellHyperlink {
  text?: string;
  hyperlink?: string;
}
interface ExcelCellError {
  error: string;
}
interface ExcelRow {
  values: unknown[];
}
interface ExcelWorksheet {
  name: string;
  eachRow(opts: { includeEmpty: boolean }, cb: (row: ExcelRow) => void): void;
}
interface ExcelWorkbook {
  worksheets: ExcelWorksheet[];
  xlsx: { load(buffer: ArrayBuffer): Promise<unknown> };
}
const ExcelJS = require_('exceljs') as { Workbook: new () => ExcelWorkbook };

/**
 * Extract text from a .docx.
 *
 * Goes through mammoth's HTML writer rather than its text or Markdown writers,
 * both of which drop tables entirely — `extractRawText` and `convertToMarkdown`
 * each render a two-column table as a flat run of cells. The HTML writer is the
 * only one that emits `<table>`, so tables reach `htmlToText` intact and leave
 * it as Markdown.
 */
export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(buffer) });
  return htmlToText(value);
}

/**
 * Extract text from a .xlsx, one Markdown table per worksheet under its name.
 *
 * The sheet name is emitted as a heading because it is often the only thing
 * naming what the numbers are ("Q3 实际" vs "Q3 预算"); a bare grid of figures
 * retrieves against nothing.
 */
export async function extractXlsxText(buffer: ArrayBuffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sections: string[] = [];
  for (const sheet of workbook.worksheets) {
    const rows: string[][] = [];
    // `includeEmpty: false` skips rows that carry no cells at all; a row of
    // blank-but-styled cells still arrives and is dropped below.
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = readRow(row);
      if (cells.some((cell) => cell !== '')) rows.push(cells);
    });
    if (rows.length === 0) continue;
    sections.push(`## ${sheet.name}\n${toMarkdownTable(rows)}`);
  }
  return sections.join('\n\n');
}

/**
 * One worksheet row as plain strings.
 *
 * `row.values` is 1-based with a hole at index 0 — exceljs mirrors the column
 * numbering rather than JS array indexing — so iteration starts at 1. Trailing
 * blanks are trimmed so a sheet whose used range is wider than its data does
 * not emit rows padded with empty columns.
 */
function readRow(row: ExcelRow): string[] {
  const cells: string[] = [];
  for (let i = 1; i < row.values.length; i++) {
    cells.push(cellToText(row.values[i]));
  }
  while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/**
 * One cell as text.
 *
 * exceljs returns a union, not a primitive: a formula cell is `{formula,
 * result}`, a styled cell is `{richText}`, a link is `{text, hyperlink}`, a
 * broken formula is `{error}`, and a date is a `Date`. Left unhandled these
 * stringify to "[object Object]", which is what a retriever would then index.
 */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) {
      return (value as ExcelCellRich).richText.map((run) => run.text ?? '').join('');
    }
    if ('formula' in value) {
      // The cached result is what the sheet displays; the formula source
      // ("B2*2") means nothing to a retriever. An uncalculated file has no
      // result, and an empty cell is the honest answer there.
      return cellToText((value as ExcelCellFormula).result);
    }
    if ('error' in value) return (value as ExcelCellError).error;
    if ('text' in value) return (value as ExcelCellHyperlink).text ?? '';
    return '';
  }
  return String(value);
}

/**
 * Rows to a Markdown table, first row as the header.
 *
 * Rows are padded to the widest so the pipes line up; a ragged Markdown table
 * renders as literal pipes rather than a table.
 */
function toMarkdownTable(rows: string[][]): string {
  const width = Math.max(...rows.map((row) => row.length));
  const line = (cells: string[]) => {
    const padded = [...cells, ...Array(width - cells.length).fill('')];
    return `| ${padded.join(' | ')} |`;
  };
  const [header, ...body] = rows as [string[], ...string[][]];
  return [line(header), `| ${Array(width).fill('---').join(' | ')} |`, ...body.map(line)].join(
    '\n',
  );
}

/**
 * Convert mammoth's HTML to text, keeping tables as Markdown.
 *
 * The input is not arbitrary HTML: it is mammoth's own output, a small closed
 * set of tags (h1-h6, p, ul/ol/li, table/tr/td, strong/em, a, br) with every
 * character of document text escaped. That is what makes regex viable here
 * where it would not be in general. Nested tables — rare, and something Word
 * itself discourages — degrade to a slightly garbled inner row rather than
 * failing, since the inner `</table>` closes the outer match.
 *
 * Nothing here is a sanitizer. The result is embedded and fed to a model, never
 * rendered as markup.
 */
function htmlToText(html: string): string {
  const withTables = html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, body: string) =>
    tableToMarkdown(body),
  );
  return stripTags(withTables);
}

function tableToMarkdown(tableBody: string): string {
  const rows: string[][] = [];
  for (const [, rowBody] of tableBody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = [];
    for (const [, cellBody] of (rowBody as string).matchAll(
      /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi,
    )) {
      // A cell's own newlines and pipes would break the one-row-per-line
      // Markdown table it is about to land in.
      cells.push(
        stripTags(cellBody as string)
          .replace(/\s+/g, ' ')
          .replace(/\|/g, '\\|')
          .trim(),
      );
    }
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0) return '';
  // Blank lines around it so the table is its own paragraph — the chunker's
  // highest-priority separator is '\n\n', so this is also what gives it a
  // chance of being chunked whole.
  return `\n\n${toMarkdownTable(rows)}\n\n`;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function stripTags(html: string): string {
  const text = html
    // Block-level boundaries become newlines before the tags are dropped, or
    // every paragraph in the document would run into the next.
    .replace(/<(?:p|div|br|li|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, code: string) => {
    if (!code.startsWith('#')) return NAMED_ENTITIES[code.toLowerCase()] ?? match;
    const point =
      code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    // fromCodePoint throws on surrogates and anything past U+10FFFF, and a
    // malformed entity in a document must not fail the whole ingestion.
    try {
      return String.fromCodePoint(point);
    } catch {
      return match;
    }
  });
}
