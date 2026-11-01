import { constants as fsConstants, promises as fs } from 'node:fs';
import { posix } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { ERROR_CODES, EXCEL_PDF_LIMITS } from '@b2b/contracts';
import { ExcelPdfProcessingError } from './excel-pdf-errors';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;
const MAX_METADATA_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_METADATA_TOTAL_BYTES = 8 * 1024 * 1024;
const QUOTATION_TITLE_ROW = 5;

interface ZipEntry {
  name: string;
  versionMadeBy: number;
  versionNeeded: number;
  flags: number;
  method: number;
  modifiedTime: number;
  modifiedDate: number;
  crc32: number;
  compressedBytes: number;
  uncompressedBytes: number;
  internalAttributes: number;
  externalAttributes: number;
  localHeaderOffset: number;
}

export interface XlsxValidationResult {
  entryCount: number;
  uncompressedBytes: number;
}

interface PrintTitleDefinition {
  localSheetId: number;
  range: string;
}

/**
 * Validates the XLSX ZIP envelope without inflating the complete workbook.
 * Central-directory limits prevent zip bombs before LibreOffice sees the file;
 * small OOXML relationship files are inflated with CRC/size checks to reject
 * external links and malformed metadata.
 */
export async function validateXlsxArchive(path: string): Promise<XlsxValidationResult> {
  let handle;
  try {
    handle = await fs.open(path, fsConstants.O_RDONLY);
  } catch {
    throw invalidFile();
  }

  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < EOCD_SIZE) throw invalidFile();
    if (stat.size > EXCEL_PDF_LIMITS.maxUploadBytes) throw invalidFile();

    const eocd = await findEndOfCentralDirectory(handle, stat.size);
    assertSingleDiskArchive(eocd);
    if (eocd.entryCount === 0) throw invalidFile();
    if (eocd.entryCount > EXCEL_PDF_LIMITS.maxZipEntries) throw zipBomb();
    if (
      eocd.centralDirectorySize <= 0 ||
      eocd.centralDirectorySize > MAX_CENTRAL_DIRECTORY_BYTES ||
      eocd.centralDirectoryOffset + eocd.centralDirectorySize > eocd.offset
    ) {
      throw invalidFile();
    }

    const central = Buffer.alloc(eocd.centralDirectorySize);
    await readExactly(handle, central, 0, central.byteLength, eocd.centralDirectoryOffset);
    const entries = parseCentralDirectory(central, eocd.entryCount);
    validateEntrySet(entries, central.byteLength);

    const contentTypes = entries.find(
      (entry) => entry.name.toLowerCase() === '[content_types].xml',
    );
    if (!contentTypes || contentTypes.uncompressedBytes > MAX_METADATA_ENTRY_BYTES) {
      throw invalidFile();
    }
    const contentTypesXml = await readEntry(handle, contentTypes).then((buffer) =>
      buffer.toString('utf8'),
    );
    if (
      /(?:macroEnabled|vbaProject|ms-excel\.addin\.|application\/vnd\.ms-excel\.sheet)/i.test(
        contentTypesXml,
      )
    ) {
      throw new ExcelPdfProcessingError(
        ERROR_CODES.excelPdfMacroNotAllowed,
        'Macro-enabled workbooks are not supported.',
      );
    }

    let metadataBytes = 0;
    for (const entry of entries) {
      if (!entry.name.toLowerCase().endsWith('.rels')) continue;
      if (entry.uncompressedBytes > MAX_METADATA_ENTRY_BYTES) throw invalidFile();
      metadataBytes += entry.uncompressedBytes;
      if (metadataBytes > MAX_METADATA_TOTAL_BYTES) throw invalidFile();
      const xml = await readEntry(handle, entry).then((buffer) => buffer.toString('utf8'));
      if (/<Relationship\b[^>]*\bTargetMode\s*=\s*["']External["']/i.test(xml)) {
        throw new ExcelPdfProcessingError(
          ERROR_CODES.excelPdfExternalLinkNotAllowed,
          'The workbook contains an external relationship.',
        );
      }
    }

    return {
      entryCount: entries.length,
      uncompressedBytes: entries.reduce((sum, entry) => sum + entry.uncompressedBytes, 0),
    };
  } finally {
    await handle.close();
  }
}

/**
 * Produces a temporary print-optimised XLSX without loading the workbook into
 * ExcelJS or another object model. Unchanged media and relationship entries are
 * copied as their original compressed bytes; only workbook/sheet XML entries
 * that control print titles and page setup are inflated and rewritten.
 */
export async function normaliseXlsxForPdf(
  inputPath: string,
  outputPath: string,
): Promise<XlsxValidationResult> {
  const validation = await validateXlsxArchive(inputPath);
  let input: Awaited<ReturnType<typeof fs.open>> | null = null;
  let output: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    input = await fs.open(inputPath, fsConstants.O_RDONLY);
    const stat = await input.stat();
    const eocd = await findEndOfCentralDirectory(input, stat.size);
    const central = Buffer.alloc(eocd.centralDirectorySize);
    await readExactly(input, central, 0, central.byteLength, eocd.centralDirectoryOffset);
    const entries = parseCentralDirectory(central, eocd.entryCount);
    const quotationPrintTitles = await findQuotationPrintTitles(input, entries);

    output = await fs.open(outputPath, 'wx', 0o600);
    const centralParts: Buffer[] = [];
    let outputOffset = 0;

    for (const entry of entries) {
      const name = Buffer.from(entry.name, 'utf8');
      let method = entry.method;
      let crc = entry.crc32;
      let compressedBytes = entry.compressedBytes;
      let uncompressedBytes = entry.uncompressedBytes;
      let rewritten: Buffer | null = null;

      if (shouldNormaliseEntry(entry.name)) {
        const original = await readEntry(input, entry);
        const xml =
          entry.name.toLowerCase() === 'xl/workbook.xml'
            ? normaliseWorkbookXml(original.toString('utf8'), quotationPrintTitles)
            : normaliseSheetXml(original.toString('utf8'), /chartsheets\//i.test(entry.name));
        rewritten = deflateRawSync(Buffer.from(xml, 'utf8'));
        method = 8;
        uncompressedBytes = Buffer.byteLength(xml);
        compressedBytes = rewritten.byteLength;
        crc = crc32(Buffer.from(xml, 'utf8'));
      }

      // Data descriptors are unnecessary because the central directory gives
      // us CRCs and sizes. Clearing bit 3 also keeps the rewritten archive
      // straightforward for older spreadsheet/PDF engines.
      const flags = (entry.flags | 0x0800) & ~0x0008;
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(LOCAL_SIGNATURE, 0);
      localHeader.writeUInt16LE(entry.versionNeeded, 4);
      localHeader.writeUInt16LE(flags, 6);
      localHeader.writeUInt16LE(method, 8);
      localHeader.writeUInt16LE(entry.modifiedTime, 10);
      localHeader.writeUInt16LE(entry.modifiedDate, 12);
      localHeader.writeUInt32LE(crc, 14);
      localHeader.writeUInt32LE(compressedBytes, 18);
      localHeader.writeUInt32LE(uncompressedBytes, 22);
      localHeader.writeUInt16LE(name.byteLength, 26);
      localHeader.writeUInt16LE(0, 28);

      await writeAll(output, localHeader, localHeader.byteLength, outputOffset);
      outputOffset += localHeader.byteLength;
      await writeAll(output, name, name.byteLength, outputOffset);
      outputOffset += name.byteLength;

      if (rewritten) {
        await writeAll(output, rewritten, rewritten.byteLength, outputOffset);
      } else {
        const local = Buffer.alloc(30);
        await readExactly(input, local, 0, local.byteLength, entry.localHeaderOffset);
        if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw invalidFile();
        const localNameLength = local.readUInt16LE(26);
        const localExtraLength = local.readUInt16LE(28);
        await copyRange(
          input,
          output,
          entry.localHeaderOffset + 30 + localNameLength + localExtraLength,
          outputOffset,
          compressedBytes,
        );
      }

      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(CENTRAL_SIGNATURE, 0);
      centralHeader.writeUInt16LE(entry.versionMadeBy, 4);
      centralHeader.writeUInt16LE(entry.versionNeeded, 6);
      centralHeader.writeUInt16LE(flags, 8);
      centralHeader.writeUInt16LE(method, 10);
      centralHeader.writeUInt16LE(entry.modifiedTime, 12);
      centralHeader.writeUInt16LE(entry.modifiedDate, 14);
      centralHeader.writeUInt32LE(crc, 16);
      centralHeader.writeUInt32LE(compressedBytes, 20);
      centralHeader.writeUInt32LE(uncompressedBytes, 24);
      centralHeader.writeUInt16LE(name.byteLength, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(entry.internalAttributes, 36);
      centralHeader.writeUInt32LE(entry.externalAttributes, 38);
      centralHeader.writeUInt32LE(outputOffset - localHeader.byteLength - name.byteLength, 42);
      centralParts.push(centralHeader, name);
      outputOffset += compressedBytes;
    }

    const centralDirectory = Buffer.concat(centralParts);
    await writeAll(output, centralDirectory, centralDirectory.byteLength, outputOffset);
    outputOffset += centralDirectory.byteLength;

    const ending = Buffer.alloc(EOCD_SIZE);
    ending.writeUInt32LE(EOCD_SIGNATURE, 0);
    ending.writeUInt16LE(0, 4);
    ending.writeUInt16LE(0, 6);
    ending.writeUInt16LE(entries.length, 8);
    ending.writeUInt16LE(entries.length, 10);
    ending.writeUInt32LE(centralDirectory.byteLength, 12);
    ending.writeUInt32LE(outputOffset - centralDirectory.byteLength, 16);
    ending.writeUInt16LE(0, 20);
    await writeAll(output, ending, ending.byteLength, outputOffset);
    await output.sync();
    return validation;
  } catch (error) {
    if (output) await output.close().catch(() => undefined);
    output = null;
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await input?.close().catch(() => undefined);
    await output?.close().catch(() => undefined);
  }
}

function shouldNormaliseEntry(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === 'xl/workbook.xml' ||
    /^xl\/worksheets\/sheet[^/]*\.xml$/.test(lower) ||
    /^xl\/chartsheets\/sheet[^/]*\.xml$/.test(lower)
  );
}

function normaliseWorkbookXml(xml: string, printTitles: readonly PrintTitleDefinition[]): string {
  const withoutExistingTitles = xml
    .replace(/<definedName\b(?=[^>]*\bname\s*=\s*["']_xlnm\.Print_Titles["'])[^>]*\/>/gi, '')
    .replace(
      /<definedName\b(?=[^>]*\bname\s*=\s*["']_xlnm\.Print_Titles["'])[^>]*>[\s\S]*?<\/definedName>/gi,
      '',
    );
  if (printTitles.length === 0) return withoutExistingTitles;

  const definitions = printTitles
    .map(
      ({ localSheetId, range }) =>
        `<definedName name="_xlnm.Print_Titles" localSheetId="${localSheetId}">${escapeXmlText(
          range,
        )}</definedName>`,
    )
    .join('');
  const existingBlock = /<definedNames\b[^>]*>[\s\S]*?<\/definedNames>/i;
  if (existingBlock.test(withoutExistingTitles)) {
    return withoutExistingTitles.replace(existingBlock, (block) =>
      block.replace(/<\/definedNames\s*>/i, (closing) => `${definitions}${closing}`),
    );
  }

  const selfClosingBlock = /<definedNames\b[^>]*\/>/i;
  if (selfClosingBlock.test(withoutExistingTitles)) {
    return withoutExistingTitles.replace(
      selfClosingBlock,
      `<definedNames>${definitions}</definedNames>`,
    );
  }

  if (!/<\/sheets\s*>/i.test(withoutExistingTitles)) throw invalidFile();
  return withoutExistingTitles.replace(
    /<\/sheets\s*>/i,
    (closing) => `${closing}<definedNames>${definitions}</definedNames>`,
  );
}

async function findQuotationPrintTitles(
  input: Awaited<ReturnType<typeof fs.open>>,
  entries: readonly ZipEntry[],
): Promise<PrintTitleDefinition[]> {
  const byName = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
  const workbookEntry = byName.get('xl/workbook.xml');
  const relationshipEntry = byName.get('xl/_rels/workbook.xml.rels');
  if (!workbookEntry || !relationshipEntry) return [];

  const [workbookXml, relationshipsXml] = await Promise.all([
    readEntry(input, workbookEntry).then((buffer) => buffer.toString('utf8')),
    readEntry(input, relationshipEntry).then((buffer) => buffer.toString('utf8')),
  ]);
  const relationshipTargets = parseWorkbookRelationshipTargets(relationshipsXml);
  const sheets = parseWorkbookSheets(workbookXml);
  if (sheets.length === 0) return [];

  const sharedStringsEntry = byName.get('xl/sharedstrings.xml');
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(
        await readEntry(input, sharedStringsEntry).then((buffer) => buffer.toString('utf8')),
      )
    : [];
  const definitions: PrintTitleDefinition[] = [];

  for (const [localSheetId, sheet] of sheets.entries()) {
    const target = relationshipTargets.get(sheet.relationshipId);
    if (!target) continue;
    const worksheetEntry = byName.get(target.toLowerCase());
    if (!worksheetEntry) continue;

    const worksheetXml = await readEntry(input, worksheetEntry).then((buffer) =>
      buffer.toString('utf8'),
    );
    const headerRow = findProductSkuHeaderRow(worksheetXml, sharedStrings);
    if (headerRow === null) continue;

    const quotedSheetName = `'${sheet.name.replace(/'/g, "''")}'`;
    // LibreOffice honours only the first range in a comma-separated OOXML
    // Print_Titles value. Repeat one contiguous range so both the quotation
    // title and the Product SKU header survive real PDF pagination.
    const firstRow = Math.min(QUOTATION_TITLE_ROW, headerRow);
    const lastRow = Math.max(QUOTATION_TITLE_ROW, headerRow);
    definitions.push({
      localSheetId,
      range: `${quotedSheetName}!$${firstRow}:$${lastRow}`,
    });
  }

  return definitions;
}

function parseWorkbookRelationshipTargets(xml: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/gi)) {
    const tag = match[0];
    const id = getXmlAttribute(tag, 'Id');
    const target = getXmlAttribute(tag, 'Target');
    if (!id || !target) continue;
    const normalizedTarget = target.startsWith('/')
      ? posix.normalize(target.slice(1))
      : posix.normalize(posix.join('xl', target));
    targets.set(id, normalizedTarget);
  }
  return targets;
}

function parseWorkbookSheets(xml: string): { name: string; relationshipId: string }[] {
  const sheets: { name: string; relationshipId: string }[] = [];
  for (const match of xml.matchAll(/<sheet\b[^>]*>/gi)) {
    const tag = match[0];
    const name = getXmlAttribute(tag, 'name');
    const relationshipId = getXmlAttribute(tag, 'r:id');
    if (name && relationshipId) sheets.push({ name: decodeXmlText(name), relationshipId });
  }
  return sheets;
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) =>
    [...(match[1] ?? '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
      .map((textMatch) => decodeXmlText(textMatch[1] ?? ''))
      .join(''),
  );
}

function findProductSkuHeaderRow(xml: string, sharedStrings: readonly string[]): number | null {
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)) {
    const rowNumber = Number(getXmlAttribute(rowMatch[1] ?? '', 'r'));
    if (!Number.isInteger(rowNumber) || rowNumber < 1) continue;
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const cellAttributes = cellMatch[1] ?? '';
      const cellBody = cellMatch[2] ?? '';
      const type = getXmlAttribute(cellAttributes, 't');
      let value = '';
      if (type === 's') {
        const rawIndex = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(cellBody)?.[1];
        const index = rawIndex === undefined ? Number.NaN : Number(rawIndex);
        value = Number.isInteger(index) ? (sharedStrings[index] ?? '') : '';
      } else if (type === 'inlineStr') {
        value = [...cellBody.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
          .map((match) => decodeXmlText(match[1] ?? ''))
          .join('');
      } else {
        value = decodeXmlText(/<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(cellBody)?.[1] ?? '');
      }
      if (value.toUpperCase().replace(/\s+/g, ' ').includes('PRODUCT SKU')) return rowNumber;
    }
  }
  return null;
}

function getXmlAttribute(tag: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(tag)?.[2] ?? null
  );
}

function decodeXmlText(value: string): string {
  return value.replace(
    /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi,
    (_entity, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
      switch (named?.toLowerCase()) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default:
          return _entity;
      }
    },
  );
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normaliseSheetXml(xml: string, chartsheet: boolean): string {
  const withFitToPage = chartsheet ? xml : enableFitToPage(xml);
  const root = chartsheet ? 'chartsheet' : 'worksheet';
  const pageSetup = /<pageSetup\b[^>]*\/?>/i;
  const existing = pageSetup.exec(withFitToPage)?.[0];
  const pageSetupTag = existing
    ? normalisePageSetupTag(existing)
    : '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
  const withoutPageSetup = existing ? withFitToPage.replace(pageSetup, '') : withFitToPage;
  const closing = new RegExp(`</${root}\\s*>`, 'i');
  if (!closing.test(withoutPageSetup)) throw invalidFile();

  // OOXML has a sequence-sensitive worksheet schema. pageSetup must precede
  // print headers, drawings, table parts and the worksheet-level extLst. Scan
  // only direct worksheet children: real WPS/Excel templates may contain a
  // nested <extLst/> inside autoFilter, which must not be mistaken for the
  // worksheet-level successor.
  const insertionPoint = findTopLevelElementStart(withoutPageSetup, PAGE_SETUP_SUCCESSORS);
  if (insertionPoint >= 0) {
    return `${withoutPageSetup.slice(0, insertionPoint)}${pageSetupTag}${withoutPageSetup.slice(
      insertionPoint,
    )}`;
  }
  return withoutPageSetup.replace(closing, (tag) => `${pageSetupTag}${tag}`);
}

const PAGE_SETUP_SUCCESSORS = new Set([
  'headerfooter',
  'rowbreaks',
  'colbreaks',
  'customproperties',
  'cellwatches',
  'ignorederrors',
  'smarttags',
  'drawing',
  'legacydrawing',
  'legacydrawinghf',
  'picture',
  'oleobjects',
  'controls',
  'webpublishitems',
  'tableparts',
  'extlst',
]);

function findTopLevelElementStart(xml: string, elementNames: ReadonlySet<string>): number {
  let depth = 0;
  let index = 0;
  while (index < xml.length) {
    const tagStart = xml.indexOf('<', index);
    if (tagStart < 0) return -1;
    if (xml.startsWith('<!--', tagStart)) {
      index = skipMarkup(xml, tagStart, '-->');
      continue;
    }
    if (xml.startsWith('<![CDATA[', tagStart)) {
      index = skipMarkup(xml, tagStart, ']]>');
      continue;
    }
    if (xml.startsWith('<?', tagStart)) {
      index = skipMarkup(xml, tagStart, '?>');
      continue;
    }
    if (xml.startsWith('<!', tagStart)) {
      const declarationEnd = findTagEnd(xml, tagStart);
      if (declarationEnd < 0) throw invalidFile();
      index = declarationEnd + 1;
      continue;
    }

    const tag = /^<\s*(\/?)\s*([A-Za-z_][\w:.-]*)\b/.exec(xml.slice(tagStart));
    const tagEnd = findTagEnd(xml, tagStart);
    const qualifiedName = tag?.[2];
    if (!qualifiedName || tagEnd < 0) throw invalidFile();

    const closing = tag[1] === '/';
    const name = qualifiedName.split(':').pop()?.toLowerCase() ?? '';
    const selfClosing = /\/\s*>$/.test(xml.slice(tagStart, tagEnd + 1));
    if (closing) {
      depth -= 1;
      if (depth < 0) throw invalidFile();
    } else {
      if (depth === 1 && elementNames.has(name)) return tagStart;
      if (!selfClosing) depth += 1;
    }
    index = tagEnd + 1;
  }
  return -1;
}

function skipMarkup(xml: string, start: number, terminator: string): number {
  const end = xml.indexOf(terminator, start + 2);
  if (end < 0) throw invalidFile();
  return end + terminator.length;
}

function findTagEnd(xml: string, start: number): number {
  let quote = '';
  for (let index = start + 1; index < xml.length; index += 1) {
    const char = xml[index];
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index;
    }
  }
  return -1;
}

function enableFitToPage(xml: string): string {
  const selfClosing = /<sheetPr\b[^>]*\/>/i;
  if (selfClosing.test(xml)) {
    return xml.replace(
      selfClosing,
      (tag) => `${tag.replace(/\/>$/, '>')}<pageSetUpPr fitToPage="1"/></sheetPr>`,
    );
  }

  const block = /<sheetPr\b[^>]*>[\s\S]*?<\/sheetPr>/i;
  const blockMatch = block.exec(xml);
  if (blockMatch) {
    const existing = /<pageSetUpPr\b[^>]*\/?>/i;
    // CT_SheetPr requires tabColor, then outlinePr, then pageSetUpPr. Preserve
    // existing author formatting while inserting fitToPage in schema order.
    const replacement = existing.test(blockMatch[0])
      ? blockMatch[0].replace(existing, (tag) => upsertTagAttribute(tag, 'fitToPage', '1'))
      : blockMatch[0].replace(/<\/sheetPr\s*>/i, (tag) => `<pageSetUpPr fitToPage="1"/>${tag}`);
    return xml.replace(block, replacement);
  }

  const worksheetOpen = /<worksheet\b[^>]*>/i;
  if (!worksheetOpen.test(xml)) throw invalidFile();
  return xml.replace(
    worksheetOpen,
    (tag) => `${tag}<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`,
  );
}

function normalisePageSetupTag(tag: string): string {
  let result = upsertTagAttribute(tag, 'paperSize', '9');
  result = upsertTagAttribute(result, 'orientation', 'landscape');
  result = upsertTagAttribute(result, 'fitToWidth', '1');
  return upsertTagAttribute(result, 'fitToHeight', '0');
}

function upsertTagAttribute(tag: string, name: string, value: string): string {
  const attribute = new RegExp(`\\b${name}\\s*=\\s*(["'])[^"']*\\1`, 'i');
  if (attribute.test(tag)) return tag.replace(attribute, `${name}="${value}"`);
  return tag.replace(/\s*\/?>$/, (ending) => ` ${name}="${value}"${ending}`);
}

async function findEndOfCentralDirectory(
  handle: Awaited<ReturnType<typeof fs.open>>,
  fileSize: number,
): Promise<{
  offset: number;
  entryCount: number;
  centralDirectorySize: number;
  centralDirectoryOffset: number;
  diskNumber: number;
  centralDirectoryDisk: number;
  entriesOnDisk: number;
}> {
  const tailLength = Math.min(fileSize, EOCD_SIZE + MAX_COMMENT);
  const tailStart = fileSize - tailLength;
  const tail = Buffer.alloc(tailLength);
  await readExactly(handle, tail, 0, tailLength, tailStart);
  for (let offset = tail.length - EOCD_SIZE; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(offset + 20);
    if (offset + EOCD_SIZE + commentLength !== tail.length) continue;
    return {
      offset: tailStart + offset,
      diskNumber: tail.readUInt16LE(offset + 4),
      centralDirectoryDisk: tail.readUInt16LE(offset + 6),
      entriesOnDisk: tail.readUInt16LE(offset + 8),
      entryCount: tail.readUInt16LE(offset + 10),
      centralDirectorySize: tail.readUInt32LE(offset + 12),
      centralDirectoryOffset: tail.readUInt32LE(offset + 16),
    };
  }
  throw invalidFile();
}

function assertSingleDiskArchive(eocd: {
  diskNumber: number;
  centralDirectoryDisk: number;
  entriesOnDisk: number;
  entryCount: number;
  centralDirectorySize: number;
  centralDirectoryOffset: number;
}): void {
  if (
    eocd.diskNumber !== 0 ||
    eocd.centralDirectoryDisk !== 0 ||
    eocd.entriesOnDisk !== eocd.entryCount ||
    eocd.entryCount === 0xffff ||
    eocd.centralDirectorySize === 0xffffffff ||
    eocd.centralDirectoryOffset === 0xffffffff
  ) {
    // ZIP64/multi-disk workbooks exceed the safe conversion envelope.
    throw zipBomb();
  }
}

function parseCentralDirectory(buffer: Buffer, expectedEntries: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset < buffer.byteLength) {
    if (offset + 46 > buffer.byteLength || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw invalidFile();
    }
    const versionMadeBy = buffer.readUInt16LE(offset + 4);
    const versionNeeded = buffer.readUInt16LE(offset + 6);
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const modifiedTime = buffer.readUInt16LE(offset + 12);
    const modifiedDate = buffer.readUInt16LE(offset + 14);
    const crc32 = buffer.readUInt32LE(offset + 16);
    const compressedBytes = buffer.readUInt32LE(offset + 20);
    const uncompressedBytes = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const diskStart = buffer.readUInt16LE(offset + 34);
    const internalAttributes = buffer.readUInt16LE(offset + 36);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.byteLength || diskStart !== 0) throw invalidFile();
    if (compressedBytes === 0xffffffff || uncompressedBytes === 0xffffffff) throw zipBomb();
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength);
    const name = rawName.toString((flags & 0x0800) !== 0 ? 'utf8' : 'latin1');
    entries.push({
      name,
      versionMadeBy,
      versionNeeded,
      flags,
      method,
      modifiedTime,
      modifiedDate,
      crc32,
      compressedBytes,
      uncompressedBytes,
      internalAttributes,
      externalAttributes,
      localHeaderOffset,
    });
    offset = end;
  }
  if (offset !== buffer.byteLength || entries.length !== expectedEntries) throw invalidFile();
  return entries;
}

function validateEntrySet(entries: ZipEntry[], centralDirectoryBytes: number): void {
  const names = new Set<string>();
  let totalUncompressed = 0;
  let totalCompressed = 0;
  for (const entry of entries) {
    assertSafeName(entry.name);
    if (names.has(entry.name.toLowerCase())) throw invalidFile();
    names.add(entry.name.toLowerCase());
    if ((entry.flags & 0x0001) !== 0) {
      throw new ExcelPdfProcessingError(
        ERROR_CODES.excelPdfPasswordProtected,
        'Encrypted ZIP entries are not supported.',
      );
    }
    if (entry.method !== 0 && entry.method !== 8) throw invalidFile();
    if (entry.uncompressedBytes > EXCEL_PDF_LIMITS.maxZipEntryBytes) throw zipBomb();
    totalUncompressed += entry.uncompressedBytes;
    totalCompressed += entry.compressedBytes;
    if (totalUncompressed > EXCEL_PDF_LIMITS.maxZipUncompressedBytes) throw zipBomb();
    if (
      entry.uncompressedBytes > 1024 * 1024 &&
      entry.compressedBytes > 0 &&
      entry.uncompressedBytes / entry.compressedBytes > EXCEL_PDF_LIMITS.maxCompressionRatio
    ) {
      throw zipBomb();
    }
    if (entry.method === 0 && entry.compressedBytes !== entry.uncompressedBytes)
      throw invalidFile();
    if (isDisallowedEntry(entry.name)) {
      throw new ExcelPdfProcessingError(
        /vbaProject\.bin$/i.test(entry.name)
          ? ERROR_CODES.excelPdfMacroNotAllowed
          : ERROR_CODES.excelPdfExternalLinkNotAllowed,
        'The workbook contains a feature that is not allowed during PDF conversion.',
      );
    }
  }
  const normalized = new Set([...names].map((name) => name.replace(/^\/+/, '')));
  if (!normalized.has('[content_types].xml') || !normalized.has('xl/workbook.xml')) {
    throw invalidFile();
  }
  if (totalCompressed === 0 || totalCompressed > totalUncompressed + centralDirectoryBytes) {
    throw invalidFile();
  }
}

function assertSafeName(name: string): void {
  const withoutDirectorySlash = name.endsWith('/') ? name.slice(0, -1) : name;
  if (
    !name ||
    name.includes('\u0000') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    withoutDirectorySlash
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw invalidFile();
  }
}

function isDisallowedEntry(name: string): boolean {
  return /(^|\/)(vbaProject\.bin|externalLinks\/|embeddings\/|activeX\/|connections\.xml)/i.test(
    name,
  );
}

async function readEntry(
  handle: Awaited<ReturnType<typeof fs.open>>,
  entry: ZipEntry,
): Promise<Buffer> {
  const header = Buffer.alloc(30);
  await readExactly(handle, header, 0, header.byteLength, entry.localHeaderOffset);
  if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) throw invalidFile();
  const flags = header.readUInt16LE(6);
  const method = header.readUInt16LE(8);
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  if ((flags & 0x0001) !== 0) {
    throw new ExcelPdfProcessingError(
      ERROR_CODES.excelPdfPasswordProtected,
      'Encrypted ZIP entries are not supported.',
    );
  }
  if (method !== entry.method) throw invalidFile();
  const localName = Buffer.alloc(nameLength);
  await readExactly(handle, localName, 0, nameLength, entry.localHeaderOffset + 30);
  if (localName.toString('utf8') !== entry.name) throw invalidFile();
  const compressed = Buffer.alloc(entry.compressedBytes);
  await readExactly(
    handle,
    compressed,
    0,
    compressed.byteLength,
    entry.localHeaderOffset + 30 + nameLength + extraLength,
  );

  let output: Buffer;
  if (entry.method === 0) {
    output = compressed;
  } else {
    try {
      output = inflateRawSync(compressed, {
        maxOutputLength: Math.max(1, entry.uncompressedBytes + 1),
      });
    } catch {
      throw invalidFile();
    }
  }
  if (output.byteLength !== entry.uncompressedBytes || crc32(output) !== entry.crc32) {
    throw invalidFile();
  }
  return output;
}

async function readExactly(
  handle: Awaited<ReturnType<typeof fs.open>>,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number,
): Promise<void> {
  let read = 0;
  while (read < length) {
    const result = await handle.read(buffer, offset + read, length - read, position + read);
    if (result.bytesRead === 0) throw invalidFile();
    read += result.bytesRead;
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof fs.open>>,
  buffer: Buffer,
  length: number,
  position: number,
): Promise<void> {
  let written = 0;
  while (written < length) {
    const result = await handle.write(buffer, written, length - written, position + written);
    if (result.bytesWritten === 0) throw invalidFile();
    written += result.bytesWritten;
  }
}

async function copyRange(
  input: Awaited<ReturnType<typeof fs.open>>,
  output: Awaited<ReturnType<typeof fs.open>>,
  inputPosition: number,
  outputPosition: number,
  length: number,
): Promise<void> {
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, length)));
  let copied = 0;
  while (copied < length) {
    const bytes = Math.min(buffer.byteLength, length - copied);
    await readExactly(input, buffer, 0, bytes, inputPosition + copied);
    await writeAll(output, buffer, bytes, outputPosition + copied);
    copied += bytes;
  }
}

function invalidFile(): ExcelPdfProcessingError {
  return new ExcelPdfProcessingError(
    ERROR_CODES.excelPdfFileInvalid,
    'The uploaded workbook is not a valid XLSX archive.',
  );
}

function zipBomb(): ExcelPdfProcessingError {
  return new ExcelPdfProcessingError(
    ERROR_CODES.excelPdfZipBomb,
    'The uploaded workbook exceeds safe archive expansion limits.',
  );
}

let crcTable: Uint32Array | null = null;

function crc32(buffer: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
