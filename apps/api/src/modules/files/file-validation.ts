import { ALLOWED_IMAGE_MIME_TYPES } from '@b2b/contracts';

export type DetectedKind = 'jpeg' | 'png' | 'webp' | 'xlsx' | 'pdf' | 'mp4' | 'webm' | 'unknown';

// Content sniffing. The declared MIME type and file extension are never trusted
// on their own (docs/11 §2, docs/13 §1).
export function detectKind(buffer: Buffer): DetectedKind {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buffer.length < 12) return 'unknown';
  const bytes = buffer.subarray(0, 12);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  // OOXML files are ZIP containers: "PK\x03\x04".
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)
    return 'xlsx';
  if (buffer.length >= 12 && buffer.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'webm';
  }
  return 'unknown';
}

export const IMAGE_MIME_BY_KIND: Record<'jpeg' | 'png' | 'webp', string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const VIDEO_MIME_BY_KIND: Record<'mp4' | 'webm', string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export const PDF_MIME = 'application/pdf';

export function isAllowedImageMime(mime: string): boolean {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * Generic public-file route policy.
 *
 * Product sources are excluded even when their asset row says public; they are
 * only served through the publication-gated versioned route. Private workbooks
 * and future attachment purposes also stay inaccessible.
 */
export function isPublicFileServable(asset: {
  isPublic: boolean;
  purpose: string;
  status: string;
}): boolean {
  return asset.isPublic && asset.purpose !== 'product-image' && asset.status === 'ready';
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface UploadPurposeRules {
  kind: 'image' | 'excel' | 'video' | 'document';
  extensions: string[];
  /** Explicit allowlist: a new purpose must opt in before any public URL is issued. */
  isPublic: boolean;
}

export const PURPOSE_RULES: Record<string, UploadPurposeRules> = {
  'product-image': {
    kind: 'image',
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
    isPublic: true,
  },
  'category-cover': {
    kind: 'image',
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
    isPublic: true,
  },
  'ad-image': {
    kind: 'image',
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
    isPublic: true,
  },
  logo: { kind: 'image', extensions: ['.jpg', '.jpeg', '.png', '.webp'], isPublic: true },
  content: { kind: 'image', extensions: ['.jpg', '.jpeg', '.png', '.webp'], isPublic: true },
  'factory-media-image': {
    kind: 'image',
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
    isPublic: true,
  },
  'factory-media-video': { kind: 'video', extensions: ['.mp4', '.webm'], isPublic: true },
  'factory-process-image': {
    kind: 'image',
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
    isPublic: true,
  },
  'credential-document': {
    kind: 'document',
    extensions: ['.pdf', '.jpg', '.jpeg', '.png', '.webp'],
    isPublic: true,
  },
  // Workbooks, PI exports and future private attachments must not inherit a
  // public URL merely because they share the file service (docs/31 §5.4).
  'quote-template': { kind: 'excel', extensions: ['.xlsx'], isPublic: false },
};

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index === -1 ? '' : fileName.slice(index).toLowerCase();
}

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Reads the pixel size straight out of the image header.
 *
 * A pixel limit that is only checked by a downstream decoder is not a limit: the
 * API has no image library (the worker owns re-encoding), so the size is parsed
 * from the container header of the three formats this project accepts. A header
 * that cannot be parsed returns `null` and the upload is refused - an
 * unparseable "image" is exactly the payload a signature check alone would let
 * through (docs/24 §7).
 */
export function readImageDimensions(buffer: Buffer, kind: DetectedKind): ImageDimensions | null {
  if (kind === 'png') return readPngDimensions(buffer);
  if (kind === 'jpeg') return readJpegDimensions(buffer);
  if (kind === 'webp') return readWebpDimensions(buffer);
  return null;
}

function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(8) !== 13) return null;
  if (buffer.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return validDimensions(width, height);
}

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer.readUInt8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = buffer.readUInt8(offset + 1);
    // Padding fill bytes are legal between segments.
    while (marker === 0xff && offset + 3 < buffer.length) {
      offset += 1;
      marker = buffer.readUInt8(offset + 1);
    }
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 9 > buffer.length) return null;
      return validDimensions(buffer.readUInt16BE(offset + 7), buffer.readUInt16BE(offset + 5));
    }
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

function readWebpDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 30) return null;
  const chunk = buffer.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    if (
      buffer.readUInt8(23) !== 0x9d ||
      buffer.readUInt8(24) !== 0x01 ||
      buffer.readUInt8(25) !== 0x2a
    ) {
      return null;
    }
    return validDimensions(buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff);
  }
  if (chunk === 'VP8L') {
    if (buffer.readUInt8(20) !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    return validDimensions((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8X') {
    const width =
      (buffer.readUInt8(24) | (buffer.readUInt8(25) << 8) | (buffer.readUInt8(26) << 16)) + 1;
    const height =
      (buffer.readUInt8(27) | (buffer.readUInt8(28) << 8) | (buffer.readUInt8(29) << 16)) + 1;
    return validDimensions(width, height);
  }
  return null;
}

function validDimensions(width: number, height: number): ImageDimensions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < 1 || height < 1) return null;
  return { width, height };
}

// OOXML packages contain a "[Content_Types].xml" entry near the start of the
// archive; macro-enabled workbooks (.xlsm) also match the ZIP signature and are
// therefore rejected by extension and by this marker check.
export function looksLikeXlsx(buffer: Buffer): boolean {
  const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('latin1');
  if (!head.includes('[Content_Types].xml')) return false;
  return !head.includes('vbaProject.bin');
}
