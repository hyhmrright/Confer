import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { crc32, deflateRawSync } from 'node:zlib';
import { extractDocxText, extractXlsxText } from './office-parser.js';
import { MAX_OOXML_MARKUP } from './rag-config.js';

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

// A deflated zip, built by hand: the hostile shapes below are exactly what a
// document writer would refuse to produce.
function zipOf(entries: Record<string, string | Buffer>): ArrayBuffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text);
    const packed = deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, packed);
    directory.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  const out = Buffer.concat([...parts, directoryBytes, end]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length) as ArrayBuffer;
}

// `part` is where the main document lives; mammoth finds it through `_rels`, so
// it need not be called document.xml at all.
function docxWithBody(
  body: string,
  {
    part = 'word/document.xml',
    extra = {},
  }: { part?: string; extra?: Record<string, Buffer> } = {},
): ArrayBuffer {
  return zipOf({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${part}"/></Relationships>`,
    [part]: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    ...extra,
  });
}

describe('hostile office documents', () => {
  // Trailing whitespace was stripped with `/[^\S\n]+\n/g`, which retries a
  // whitespace run from every position inside it when the run does not end at
  // a newline. A million spaces — a few kilobytes zipped — was ~10¹² steps on
  // the gateway's only thread.
  test('a long run of spaces extracts in linear time', async () => {
    const run = `<w:p><w:r><w:t xml:space="preserve">${' '.repeat(1_000_000)}x</w:t></w:r></w:p>`;
    const started = performance.now();
    expect(await extractDocxText(docxWithBody(run))).toBe('x');
    expect(performance.now() - started).toBeLessThan(2000);
  });

  // mammoth peaked at 2.8 GB of RSS on 20 MB of paragraph XML that zipped to
  // 130 KB. The archive has to be refused before a parser sees it.
  const paragraph = '<w:p><w:r><w:t>hello world</w:t></w:r></w:p>'; // six `<`
  const paragraphs = paragraph.repeat(Math.ceil(MAX_OOXML_MARKUP / 6) + 1);

  test('refuses a .docx whose markup passes the budget', async () => {
    const bomb = docxWithBody(paragraphs);
    expect(bomb.byteLength).toBeLessThan(100_000);
    await expect(extractDocxText(bomb)).rejects.toThrow('expands past');
  });

  // The main document is found through `_rels`, so a budget keyed on the
  // `.xml` suffix was one rename away from not applying.
  test('refuses the same document under a name that is not .xml', async () => {
    const bomb = docxWithBody(paragraphs, { part: 'word/document.bin' });
    await expect(extractDocxText(bomb)).rejects.toThrow('expands past');
  });

  test('refuses a .xlsx whose markup passes the budget', async () => {
    const bomb = zipOf({ 'xl/worksheets/sheet1.xml': '<c/>'.repeat(MAX_OOXML_MARKUP + 1) });
    await expect(extractXlsxText(bomb)).rejects.toThrow('expands past');
  });

  // Binary parts hold `<` and `=` only by chance, so a document that is mostly
  // pictures must not be mistaken for a markup bomb.
  test('admits a document carrying megabytes of image data', async () => {
    const image = randomBytes(12 * 1024 * 1024);
    const archive = docxWithBody('<w:p><w:r><w:t>caption</w:t></w:r></w:p>', {
      extra: { 'word/media/image1.png': image },
    });
    expect(await extractDocxText(archive)).toBe('caption');
  });

  // JSZip shifts every offset when the central directory does not end where
  // the end record sits, so a harmless directory at the stated offset could
  // front for the one the parser actually reads.
  test('refuses an archive whose central directory is not where it says', async () => {
    const archive = docxWithBody('<w:p/>');
    const bytes = Buffer.from(archive);
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    bytes.writeUInt32LE(bytes.readUInt32LE(end + 12) - 1, end + 12);
    await expect(extractDocxText(archive)).rejects.toThrow('Not a readable');
  });

  // JSZip reads directory records for as long as their signature continues,
  // whatever count the end record declares, so a walk bound by that count
  // missed every record past it — the main document included.
  test('refuses an archive whose end record understates its entries', async () => {
    const archive = docxWithBody('<w:p/>');
    const bytes = Buffer.from(archive);
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    bytes.writeUInt16LE(1, end + 8);
    bytes.writeUInt16LE(1, end + 10);
    await expect(extractDocxText(archive)).rejects.toThrow('Not a readable');
  });

  test('refuses an end record that sends the zip reader to ZIP64', async () => {
    const archive = docxWithBody('<w:p/>');
    const bytes = Buffer.from(archive);
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    bytes.writeUInt16LE(0xffff, end + 4);
    await expect(extractDocxText(archive)).rejects.toThrow('Not a readable');
  });
});
