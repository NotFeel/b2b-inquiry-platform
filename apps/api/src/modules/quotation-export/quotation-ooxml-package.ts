import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { EMU_PER_PIXEL_AT_96_DPI, type ImageFitResult } from './quotation-image-fitter';
import type { QuotationProductImageAnchor } from './quotation-image-embedder';
import type { TemplateDrawingImageSnapshot } from './quotation-drawing-preserver';

interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
  selfClosing: boolean;
}

interface OoxmlRelationship {
  id: string;
  type: string;
  target: string;
  targetMode?: string;
}

interface DrawingImageAnchor {
  kind: 'oneCellAnchor' | 'twoCellAnchor';
  element: XmlElement;
  from: { col: number; colOff: number; row: number; rowOff: number };
  to?: { col: number; colOff: number; row: number; rowOff: number };
  ext?: { cx: number; cy: number };
  relationshipId: string;
  mediaPath: string;
  mediaSha256: string;
}

interface ResolvedDrawingPackage {
  zip: JSZip;
  worksheetPath: string;
  drawingPath: string;
  drawingXml: string;
  drawingRoot: XmlElement;
  relationships: Map<string, OoxmlRelationship>;
  anchors: DrawingImageAnchor[];
}

export interface OoxmlExpectedProductImage {
  anchor: QuotationProductImageAnchor;
  fit: ImageFitResult;
}

export interface QuotationOoxmlValidationOptions {
  sheetName: string;
  fixedImages: readonly TemplateDrawingImageSnapshot[];
  productImages: readonly OoxmlExpectedProductImage[];
}

export interface QuotationOoxmlValidationError {
  code: string;
  message: string;
  repairable: boolean;
  anchorIndex?: number;
}

export interface QuotationOoxmlValidationReport {
  valid: boolean;
  repaired: boolean;
  errors: QuotationOoxmlValidationError[];
  productAnchors: number;
}

export class QuotationOoxmlError extends Error {
  constructor(
    message: string,
    readonly reason: string,
    readonly errors: readonly QuotationOoxmlValidationError[] = [],
  ) {
    super(message);
    this.name = 'QuotationOoxmlError';
  }
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function findTagEnd(xml: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return index;
  }
  throw new QuotationOoxmlError('An XML tag is not terminated.', 'OOXML_XML_INVALID');
}

function parseAttributes(tagBody: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let index = 0;
  while (index < tagBody.length) {
    while (/\s/.test(tagBody[index] ?? '')) index += 1;
    const nameStart = index;
    while (index < tagBody.length && !/[\s=]/.test(tagBody[index] ?? '')) index += 1;
    const name = tagBody.slice(nameStart, index);
    if (!name) break;
    while (/\s/.test(tagBody[index] ?? '')) index += 1;
    if (tagBody[index] !== '=') {
      throw new QuotationOoxmlError('An XML attribute is invalid.', 'OOXML_XML_INVALID');
    }
    index += 1;
    while (/\s/.test(tagBody[index] ?? '')) index += 1;
    const quote = tagBody[index];
    if (quote !== '"' && quote !== "'") {
      throw new QuotationOoxmlError('An XML attribute is invalid.', 'OOXML_XML_INVALID');
    }
    index += 1;
    const valueStart = index;
    while (index < tagBody.length && tagBody[index] !== quote) index += 1;
    if (index >= tagBody.length) {
      throw new QuotationOoxmlError('An XML attribute is invalid.', 'OOXML_XML_INVALID');
    }
    attributes[name] = decodeXmlText(tagBody.slice(valueStart, index));
    index += 1;
  }
  return attributes;
}

/** Small namespace-preserving XML scanner used for reviewable OOXML structural checks. */
function parseXml(xml: string): XmlElement {
  const root: XmlElement = {
    name: '#document',
    attributes: {},
    children: [],
    text: '',
    start: 0,
    openEnd: 0,
    closeStart: xml.length,
    end: xml.length,
    selfClosing: false,
  };
  const stack: XmlElement[] = [root];
  let cursor = 0;

  while (cursor < xml.length) {
    const open = xml.indexOf('<', cursor);
    if (open < 0) {
      stack[stack.length - 1]!.text += decodeXmlText(xml.slice(cursor));
      break;
    }
    if (open > cursor) stack[stack.length - 1]!.text += decodeXmlText(xml.slice(cursor, open));

    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4);
      if (end < 0) throw new QuotationOoxmlError('An XML comment is invalid.', 'OOXML_XML_INVALID');
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const end = xml.indexOf(']]>', open + 9);
      if (end < 0) throw new QuotationOoxmlError('XML CDATA is invalid.', 'OOXML_XML_INVALID');
      stack[stack.length - 1]!.text += xml.slice(open + 9, end);
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<?', open)) {
      const end = xml.indexOf('?>', open + 2);
      if (end < 0)
        throw new QuotationOoxmlError('An XML declaration is invalid.', 'OOXML_XML_INVALID');
      cursor = end + 2;
      continue;
    }
    if (xml.startsWith('<!', open)) {
      const end = findTagEnd(xml, open + 2);
      cursor = end + 1;
      continue;
    }

    const close = findTagEnd(xml, open + 1);
    const tagBody = xml.slice(open + 1, close);
    if (tagBody.startsWith('/')) {
      const name = tagBody.slice(1).trim();
      const current = stack.pop();
      if (!current || current.name !== name || current === root) {
        throw new QuotationOoxmlError('XML element nesting is invalid.', 'OOXML_XML_INVALID');
      }
      current.closeStart = open;
      current.end = close + 1;
      cursor = close + 1;
      continue;
    }

    const selfClosing = tagBody.trimEnd().endsWith('/');
    const content = selfClosing ? tagBody.trimEnd().slice(0, -1).trimEnd() : tagBody;
    const nameEnd = content.search(/\s/);
    const name = nameEnd < 0 ? content : content.slice(0, nameEnd);
    if (!name) throw new QuotationOoxmlError('An XML element has no name.', 'OOXML_XML_INVALID');
    const element: XmlElement = {
      name,
      attributes: parseAttributes(nameEnd < 0 ? '' : content.slice(nameEnd)),
      children: [],
      text: '',
      start: open,
      openEnd: close + 1,
      closeStart: selfClosing ? close + 1 : -1,
      end: selfClosing ? close + 1 : -1,
      selfClosing,
    };
    stack[stack.length - 1]!.children.push(element);
    if (!selfClosing) stack.push(element);
    cursor = close + 1;
  }

  if (stack.length !== 1) {
    throw new QuotationOoxmlError('An XML element is not closed.', 'OOXML_XML_INVALID');
  }
  return root;
}

function localName(name: string): string {
  const separator = name.indexOf(':');
  return separator < 0 ? name : name.slice(separator + 1);
}

function child(parent: XmlElement, name: string): XmlElement | undefined {
  return parent.children.find((entry) => localName(entry.name) === name);
}

function descendants(parent: XmlElement, name: string): XmlElement[] {
  const matches: XmlElement[] = [];
  const visit = (node: XmlElement): void => {
    for (const entry of node.children) {
      if (localName(entry.name) === name) matches.push(entry);
      visit(entry);
    }
  };
  visit(parent);
  return matches;
}

function descendant(parent: XmlElement, name: string): XmlElement | undefined {
  return descendants(parent, name)[0];
}

function descendantElements(
  parent: XmlElement,
  predicate: (element: XmlElement) => boolean,
): XmlElement[] {
  const matches: XmlElement[] = [];
  const visit = (node: XmlElement): void => {
    for (const entry of node.children) {
      if (predicate(entry)) matches.push(entry);
      visit(entry);
    }
  };
  visit(parent);
  return matches;
}

function elementNumber(parent: XmlElement, name: string): number {
  const value = child(parent, name)?.text.trim();
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new QuotationOoxmlError(`The OOXML element ${name} is invalid.`, 'OOXML_ANCHOR_INVALID');
  }
  return parsed;
}

function relationshipAttribute(element: XmlElement): string | undefined {
  return Object.entries(element.attributes).find(([name]) => name.endsWith(':embed'))?.[1];
}

function relationshipIdAttribute(element: XmlElement): string | undefined {
  return Object.entries(element.attributes).find(([name]) => name.endsWith(':id'))?.[1];
}

async function textPart(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path);
  if (!entry) {
    throw new QuotationOoxmlError(`The XLSX package is missing ${path}.`, 'OOXML_PART_MISSING');
  }
  return entry.async('string');
}

function relationships(xml: string): Map<string, OoxmlRelationship> {
  const root = parseXml(xml);
  const relationshipsElement = child(root, 'Relationships');
  if (!relationshipsElement) {
    throw new QuotationOoxmlError('A relationships part is invalid.', 'OOXML_RELS_INVALID');
  }
  return new Map(
    relationshipsElement.children
      .filter((entry) => localName(entry.name) === 'Relationship')
      .map((entry) => {
        const relationship: OoxmlRelationship = {
          id: entry.attributes.Id ?? '',
          type: entry.attributes.Type ?? '',
          target: entry.attributes.Target ?? '',
          ...(entry.attributes.TargetMode ? { targetMode: entry.attributes.TargetMode } : {}),
        };
        return [relationship.id, relationship] as const;
      }),
  );
}

function resolvePart(sourcePart: string, target: string): string {
  return posix.normalize(posix.join(posix.dirname(sourcePart), target)).replace(/^\//, '');
}

function relsPath(partPath: string): string {
  return posix.join(posix.dirname(partPath), '_rels', `${posix.basename(partPath)}.rels`);
}

async function resolveWorksheetDrawing(
  zip: JSZip,
  sheetName: string,
): Promise<{
  worksheetPath: string;
  drawingPath: string;
  drawingXml: string;
  drawingRoot: XmlElement;
  drawingRelationships: Map<string, OoxmlRelationship>;
}> {
  const rootRels = relationships(await textPart(zip, '_rels/.rels'));
  const officeDocument = [...rootRels.values()].find((relationship) =>
    relationship.type.endsWith('/officeDocument'),
  );
  if (!officeDocument) {
    throw new QuotationOoxmlError('The workbook relationship is missing.', 'OOXML_PART_MISSING');
  }
  const workbookPath = resolvePart('', officeDocument.target);
  const workbookRoot = parseXml(await textPart(zip, workbookPath));
  const matchingSheet = descendants(workbookRoot, 'sheet').find(
    (sheet) => sheet.attributes.name === sheetName,
  );
  if (!matchingSheet) {
    throw new QuotationOoxmlError('The OOXML worksheet is missing.', 'OOXML_WORKSHEET_MISSING');
  }
  const sheetRelationshipId = relationshipIdAttribute(matchingSheet);
  if (!sheetRelationshipId) {
    throw new QuotationOoxmlError('The worksheet relationship is missing.', 'OOXML_RELS_INVALID');
  }
  const workbookRelationships = relationships(await textPart(zip, relsPath(workbookPath)));
  const sheetRelationship = workbookRelationships.get(sheetRelationshipId);
  if (!sheetRelationship) {
    throw new QuotationOoxmlError('The worksheet relationship is invalid.', 'OOXML_RELS_INVALID');
  }
  const worksheetPath = resolvePart(workbookPath, sheetRelationship.target);
  const worksheetRoot = parseXml(await textPart(zip, worksheetPath));
  const drawingReference = descendant(worksheetRoot, 'drawing');
  const drawingRelationshipId = drawingReference
    ? relationshipIdAttribute(drawingReference)
    : undefined;
  if (!drawingRelationshipId) {
    throw new QuotationOoxmlError('The worksheet drawing is missing.', 'OOXML_DRAWING_MISSING');
  }
  const worksheetRelationships = relationships(await textPart(zip, relsPath(worksheetPath)));
  const drawingRelationship = worksheetRelationships.get(drawingRelationshipId);
  if (!drawingRelationship) {
    throw new QuotationOoxmlError(
      'The worksheet drawing relationship is invalid.',
      'OOXML_RELS_INVALID',
    );
  }
  const drawingPath = resolvePart(worksheetPath, drawingRelationship.target);
  const drawingXml = await textPart(zip, drawingPath);
  return {
    worksheetPath,
    drawingPath,
    drawingXml,
    drawingRoot: parseXml(drawingXml),
    drawingRelationships: relationships(await textPart(zip, relsPath(drawingPath))),
  };
}

function anchorPosition(element: XmlElement): {
  col: number;
  colOff: number;
  row: number;
  rowOff: number;
} {
  return {
    col: elementNumber(element, 'col'),
    colOff: elementNumber(element, 'colOff'),
    row: elementNumber(element, 'row'),
    rowOff: elementNumber(element, 'rowOff'),
  };
}

async function drawingImageAnchors(
  zip: JSZip,
  drawingPath: string,
  root: XmlElement,
  relationshipsById: Map<string, OoxmlRelationship>,
): Promise<DrawingImageAnchor[]> {
  const result: DrawingImageAnchor[] = [];
  const anchorElements = descendantElements(root, (entry) =>
    ['oneCellAnchor', 'twoCellAnchor'].includes(localName(entry.name)),
  );
  for (const anchor of anchorElements) {
    const picture = descendant(anchor, 'pic');
    const blip = picture ? descendant(picture, 'blip') : undefined;
    const relationshipId = blip ? relationshipAttribute(blip) : undefined;
    if (!relationshipId) continue;
    const relationship = relationshipsById.get(relationshipId);
    if (!relationship) {
      throw new QuotationOoxmlError(
        'An image anchor points to a missing relationship.',
        'OOXML_IMAGE_RELATIONSHIP_MISSING',
      );
    }
    if (relationship.targetMode?.toLowerCase() === 'external') {
      throw new QuotationOoxmlError(
        'External quotation images are not allowed.',
        'OOXML_EXTERNAL_IMAGE_RELATIONSHIP',
      );
    }
    const from = child(anchor, 'from');
    if (!from) {
      throw new QuotationOoxmlError('An image anchor has no start marker.', 'OOXML_ANCHOR_INVALID');
    }
    const to = child(anchor, 'to');
    const ext = child(anchor, 'ext');
    const mediaPath = resolvePart(drawingPath, relationship.target);
    const media = zip.file(mediaPath);
    if (!media) {
      throw new QuotationOoxmlError('An image media part is missing.', 'OOXML_MEDIA_MISSING');
    }
    result.push({
      kind: localName(anchor.name) as DrawingImageAnchor['kind'],
      element: anchor,
      from: anchorPosition(from),
      ...(to ? { to: anchorPosition(to) } : {}),
      ...(ext
        ? {
            ext: {
              cx: Number(ext.attributes.cx),
              cy: Number(ext.attributes.cy),
            },
          }
        : {}),
      relationshipId,
      mediaPath,
      mediaSha256: createHash('sha256')
        .update(await media.async('nodebuffer'))
        .digest('hex'),
    });
  }
  return result;
}

async function resolvedPackage(buffer: Buffer, sheetName: string): Promise<ResolvedDrawingPackage> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new QuotationOoxmlError(
      'The generated XLSX ZIP package is invalid.',
      'OOXML_ZIP_INVALID',
    );
  }
  const drawing = await resolveWorksheetDrawing(zip, sheetName);
  return {
    zip,
    worksheetPath: drawing.worksheetPath,
    drawingPath: drawing.drawingPath,
    drawingXml: drawing.drawingXml,
    drawingRoot: drawing.drawingRoot,
    relationships: drawing.drawingRelationships,
    anchors: await drawingImageAnchors(
      zip,
      drawing.drawingPath,
      drawing.drawingRoot,
      drawing.drawingRelationships,
    ),
  };
}

function expectedExtEmu(fit: ImageFitResult): { cx: number; cy: number } {
  return {
    cx: Math.floor(fit.width * EMU_PER_PIXEL_AT_96_DPI),
    cy: Math.floor(fit.height * EMU_PER_PIXEL_AT_96_DPI),
  };
}

function fixedAnchorMatches(
  actual: DrawingImageAnchor,
  expected: TemplateDrawingImageSnapshot,
): boolean {
  const range = expected.range;
  return (
    actual.mediaSha256 === expected.mediaSha256 &&
    actual.from.col === range.tl.nativeCol &&
    actual.from.row === range.tl.nativeRow &&
    actual.from.colOff === range.tl.nativeColOff &&
    actual.from.rowOff === range.tl.nativeRowOff &&
    Boolean(actual.to) === Boolean(range.br) &&
    (!actual.to ||
      !range.br ||
      (actual.to.col === range.br.nativeCol &&
        actual.to.row === range.br.nativeRow &&
        actual.to.colOff === range.br.nativeColOff &&
        actual.to.rowOff === range.br.nativeRowOff)) &&
    Boolean(actual.ext) === Boolean(range.ext) &&
    (!actual.ext ||
      !range.ext ||
      (actual.ext.cx === Math.floor(range.ext.width * EMU_PER_PIXEL_AT_96_DPI) &&
        actual.ext.cy === Math.floor(range.ext.height * EMU_PER_PIXEL_AT_96_DPI)))
  );
}

function productAnchorMatches(
  actual: DrawingImageAnchor,
  expected: OoxmlExpectedProductImage,
): boolean {
  const ext = expectedExtEmu(expected.fit);
  return (
    actual.kind === 'oneCellAnchor' &&
    actual.mediaSha256 === expected.anchor.mediaSha256 &&
    actual.from.col === expected.anchor.nativeCol &&
    actual.from.row === expected.anchor.nativeRow &&
    actual.from.colOff === expected.anchor.nativeColOff &&
    actual.from.rowOff === expected.anchor.nativeRowOff &&
    actual.ext?.cx === ext.cx &&
    actual.ext.cy === ext.cy
  );
}

function hasForbiddenImageFormula(xml: string): boolean {
  return /(?:DISPIMG|IMAGE)\s*\(/i.test(xml);
}

async function validateResolvedPackage(
  resolved: ResolvedDrawingPackage,
  options: QuotationOoxmlValidationOptions,
): Promise<QuotationOoxmlValidationError[]> {
  const errors: QuotationOoxmlValidationError[] = [];
  const expectedCount = options.fixedImages.length + options.productImages.length;
  if (resolved.anchors.length !== expectedCount) {
    errors.push({
      code: 'OOXML_IMAGE_COUNT_MISMATCH',
      message: `Expected ${expectedCount} image anchors but found ${resolved.anchors.length}.`,
      repairable: false,
    });
  }

  options.fixedImages.forEach((expected, index) => {
    const actual = resolved.anchors[index];
    if (!actual || !fixedAnchorMatches(actual, expected)) {
      errors.push({
        code: 'OOXML_FIXED_IMAGE_CHANGED',
        message: `Template image ${index + 1} changed during export.`,
        repairable: false,
        anchorIndex: index,
      });
    }
  });

  options.productImages.forEach((expected, productIndex) => {
    const anchorIndex = options.fixedImages.length + productIndex;
    const actual = resolved.anchors[anchorIndex];
    if (!actual || !productAnchorMatches(actual, expected)) {
      errors.push({
        code: 'OOXML_PRODUCT_ANCHOR_MISMATCH',
        message: `Product image row ${expected.anchor.rowNumber} has invalid anchor data.`,
        repairable:
          actual !== undefined &&
          actual.kind === 'oneCellAnchor' &&
          actual.mediaSha256 === expected.anchor.mediaSha256,
        anchorIndex,
      });
    }
  });

  const worksheetXml = await textPart(resolved.zip, resolved.worksheetPath);
  if (hasForbiddenImageFormula(worksheetXml)) {
    errors.push({
      code: 'OOXML_IMAGE_FORMULA_FORBIDDEN',
      message: 'The quotation worksheet contains IMAGE or DISPIMG formulas.',
      repairable: false,
    });
  }
  const contentTypes = await textPart(resolved.zip, '[Content_Types].xml');
  if (!/image\/(?:jpeg|png)/i.test(contentTypes)) {
    errors.push({
      code: 'OOXML_IMAGE_CONTENT_TYPE_MISSING',
      message: 'Image content types are missing from the generated package.',
      repairable: false,
    });
  }
  return errors;
}

export async function validateQuotationOoxmlImages(
  buffer: Buffer,
  options: QuotationOoxmlValidationOptions,
): Promise<QuotationOoxmlValidationReport> {
  const resolved = await resolvedPackage(buffer, options.sheetName);
  const errors = await validateResolvedPackage(resolved, options);
  return {
    valid: errors.length === 0,
    repaired: false,
    errors,
    productAnchors: Math.max(0, resolved.anchors.length - options.fixedImages.length),
  };
}

interface TextReplacement {
  start: number;
  end: number;
  value: string;
}

function replaceElementText(
  replacements: TextReplacement[],
  element: XmlElement | undefined,
  value: number,
): void {
  if (!element || element.selfClosing) return;
  replacements.push({
    start: element.openEnd,
    end: element.closeStart,
    value: String(value),
  });
}

function replaceElement(replacements: TextReplacement[], element: XmlElement, value: string): void {
  replacements.push({ start: element.start, end: element.end, value });
}

function applyReplacements(xml: string, replacements: TextReplacement[]): string {
  return [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, replacement) =>
        `${current.slice(0, replacement.start)}${replacement.value}${current.slice(replacement.end)}`,
      xml,
    );
}

async function repairProductAnchors(
  buffer: Buffer,
  options: QuotationOoxmlValidationOptions,
): Promise<Buffer> {
  const resolved = await resolvedPackage(buffer, options.sheetName);
  if (resolved.anchors.length !== options.fixedImages.length + options.productImages.length) {
    throw new QuotationOoxmlError(
      'The OOXML product anchor count cannot be repaired safely.',
      'OOXML_REPAIR_REFUSED',
    );
  }

  const replacements: TextReplacement[] = [];
  options.productImages.forEach((expected, productIndex) => {
    const actual = resolved.anchors[options.fixedImages.length + productIndex];
    if (!actual || !actual.ext) {
      throw new QuotationOoxmlError(
        'A product image anchor cannot be repaired safely.',
        'OOXML_REPAIR_REFUSED',
      );
    }
    if (actual.kind !== 'oneCellAnchor' || actual.mediaSha256 !== expected.anchor.mediaSha256) {
      throw new QuotationOoxmlError(
        'The OOXML product image relationship is not repairable.',
        'OOXML_REPAIR_REFUSED',
      );
    }
    const from = child(actual.element, 'from');
    const ext = child(actual.element, 'ext');
    if (!from || !ext) {
      throw new QuotationOoxmlError(
        'A product image anchor is structurally incomplete.',
        'OOXML_REPAIR_REFUSED',
      );
    }
    replaceElementText(replacements, child(from, 'col'), expected.anchor.nativeCol);
    replaceElementText(replacements, child(from, 'colOff'), expected.anchor.nativeColOff);
    replaceElementText(replacements, child(from, 'row'), expected.anchor.nativeRow);
    replaceElementText(replacements, child(from, 'rowOff'), expected.anchor.nativeRowOff);
    const targetExt = expectedExtEmu(expected.fit);
    replaceElement(replacements, ext, `<${ext.name} cx="${targetExt.cx}" cy="${targetExt.cy}"/>`);
  });

  resolved.zip.file(resolved.drawingPath, applyReplacements(resolved.drawingXml, replacements));
  return resolved.zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * Default path is ExcelJS. A package-level defect is repaired only when every
 * failing product anchor still points to the expected original media bytes.
 */
export async function ensureQuotationOoxmlImages(
  buffer: Buffer,
  options: QuotationOoxmlValidationOptions,
): Promise<{ buffer: Buffer; report: QuotationOoxmlValidationReport }> {
  const initial = await validateQuotationOoxmlImages(buffer, options);
  if (initial.valid) return { buffer, report: initial };
  if (!initial.errors.every((error) => error.repairable)) {
    throw new QuotationOoxmlError(
      'The generated quotation workbook failed OOXML image validation.',
      'OOXML_VALIDATION_FAILED',
      initial.errors,
    );
  }

  const repairedBuffer = await repairProductAnchors(buffer, options);
  const repaired = await validateQuotationOoxmlImages(repairedBuffer, options);
  if (!repaired.valid) {
    throw new QuotationOoxmlError(
      'The generated quotation workbook failed OOXML image validation after repair.',
      'OOXML_VALIDATION_FAILED',
      repaired.errors,
    );
  }
  return {
    buffer: repairedBuffer,
    report: { ...repaired, repaired: true },
  };
}
