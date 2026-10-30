export interface DetectedQuotationImage {
  extension: 'jpeg' | 'png';
  width: number;
  height: number;
}

function pngSize(buffer: Buffer): DetectedQuotationImage | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0 ? { extension: 'png', width, height } : null;
}

function jpegSize(buffer: Buffer): DetectedQuotationImage | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let markerOffset = offset + 1;
    while (markerOffset < buffer.length && buffer[markerOffset] === 0xff) markerOffset += 1;
    if (markerOffset >= buffer.length) return null;
    const marker = buffer[markerOffset];
    if (marker === undefined) return null;
    offset = markerOffset + 1;

    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && segmentLength >= 7) {
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { extension: 'jpeg', width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

/** Detects the real raster format and dimensions from bytes, not a filename. */
export function detectQuotationImage(buffer: Buffer): DetectedQuotationImage | null {
  return pngSize(buffer) ?? jpegSize(buffer);
}
