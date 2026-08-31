import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { extractDocxText, extractXlsxText } from './office-parser.js';

// The .docx is a committed fixture: writing one takes a document generator this
// package has no other reason to depend on. The .xlsx side builds its input
// through exceljs, which is already a dependency — that also makes those tests
// a round trip through the real writer, so the cell shapes under test
// (formula/richText/hyperlink/date) are the ones exceljs actually produces
// rather than ones invented here.
const require_ = createRequire(import.meta.url);
const ExcelJS = require_('exceljs') as {
  // biome-ignore lint/suspicious/noExplicitAny: test-local handle on a CJS lib
  Workbook: new () => any;
};

const DOCX_FIXTURE = new URL('../test/fixtures/sample.docx', import.meta.url);

async function docxText(): Promise<string> {
  return extractDocxText(await Bun.file(DOCX_FIXTURE).arrayBuffer());
}

// biome-ignore lint/suspicious/noExplicitAny: exceljs is untyped here
async function xlsxTextFrom(build: (workbook: any) => void): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  return extractXlsxText(buffer);
}

describe('extractDocxText', () => {
  test('extracts headings and body text', async () => {
    const text = await docxText();
    expect(text).toContain('季度报告');
    expect(text).toContain('营收同比增长 15%');
  });

  test('keeps table rows intact as markdown, not a flat run of cells', async () => {
    const text = await docxText();
    // The whole point of going through mammoth's HTML writer: its text and
    // markdown writers both render this as "地区 / 营收 / 华东 / 1200" with the
    // row-column relation gone.
    expect(text).toContain('| 地区 | 营收 | 备注 |');
    expect(text).toContain('| 华东 | 1200 |');
  });

  test('escapes a pipe inside a cell so the row stays one row', async () => {
    const text = await docxText();
    expect(text).toContain('含 A\\|B 两条线');
    const dataRow = text.split('\n').find((line) => line.includes('华东')) as string;
    // 3 columns => 4 delimiters. An unescaped pipe would make it 5.
    expect(dataRow.split(/(?<!\\)\|/).length - 1).toBe(4);
  });

  test('decodes the entities mammoth escaped', async () => {
    const text = await docxText();
    expect(text).toContain('<重点> & 附注');
    expect(text).not.toContain('&lt;');
    expect(text).not.toContain('&amp;');
  });

  test('separates block elements instead of running them together', async () => {
    const text = await docxText();
    expect(text).not.toContain('附注。首要风险');
    expect(text).toContain('表后结语。');
  });
});

describe('extractXlsxText', () => {
  test('emits one markdown table per sheet, under the sheet name', async () => {
    const text = await xlsxTextFrom((workbook) => {
      const sales = workbook.addWorksheet('销售');
      sales.addRow(['地区', '营收']);
      sales.addRow(['华东', 1200]);
      const notes = workbook.addWorksheet('备注');
      notes.addRow(['说明', '截至 2026-06-30']);
    });

    expect(text).toContain('## 销售');
    expect(text).toContain('| 地区 | 营收 |');
    expect(text).toContain('| 华东 | 1200 |');
    // The sheet name is often the only thing saying what the numbers are.
    expect(text).toContain('## 备注');
  });

  test('reads a formula cell as its cached result, not its source', async () => {
    const text = await xlsxTextFrom((workbook) => {
      const sheet = workbook.addWorksheet('S');
      sheet.addRow(['base', 'doubled']);
      sheet.getCell('A2').value = 1200;
      sheet.getCell('B2').value = { formula: 'A2*2', result: 2400 };
    });

    expect(text).toContain('2400');
    expect(text).not.toContain('A2*2');
  });

  test('flattens rich text, hyperlinks and dates rather than stringifying objects', async () => {
    const text = await xlsxTextFrom((workbook) => {
      const sheet = workbook.addWorksheet('S');
      sheet.getCell('A1').value = {
        richText: [{ text: '加粗' }, { text: '普通' }],
      };
      sheet.getCell('B1').value = { text: '官网', hyperlink: 'https://example.com' };
      sheet.getCell('C1').value = new Date(Date.UTC(2026, 5, 30));
    });

    expect(text).toContain('加粗普通');
    expect(text).toContain('官网');
    expect(text).toContain('2026-06-30');
    // The failure this guards: an unhandled cell union member indexes as junk.
    expect(text).not.toContain('[object Object]');
  });

  test('pads a short row so the table stays rectangular', async () => {
    const text = await xlsxTextFrom((workbook) => {
      const sheet = workbook.addWorksheet('S');
      sheet.addRow(['a', 'b', 'c']);
      sheet.addRow(['only']);
    });

    // A ragged markdown table renders as literal pipes instead of a table.
    expect(text).toContain('| only |  |  |');
  });

  test('skips blank rows and a sheet with no data at all', async () => {
    const text = await xlsxTextFrom((workbook) => {
      const sheet = workbook.addWorksheet('有数据');
      sheet.addRow(['x']);
      sheet.addRow([]);
      sheet.addRow(['y']);
      workbook.addWorksheet('全空');
    });

    expect(text).toContain('## 有数据');
    expect(text).not.toContain('## 全空');
    expect(text.split('\n').filter((line) => line.trim() === '|  |')).toHaveLength(0);
  });
});
