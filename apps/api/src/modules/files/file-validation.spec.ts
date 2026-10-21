import { describe, expect, it } from 'vitest';
import { PURPOSE_RULES, detectKind, readImageDimensions } from './file-validation';

/** Minimal but structurally valid PNG header + IHDR chunk. */
function pngBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'latin1');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

/** JPEG with an APP0 segment followed by a SOF0 frame header. */
function jpegBuffer(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10]);
  const sof = Buffer.alloc(11);
  sof.writeUInt8(0xff, 0);
  sof.writeUInt8(0xc0, 1);
  sof.writeUInt16BE(8, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  // The APP0 segment declares 16 bytes of payload, so the frame header must
  // start 18 bytes after its own marker - padding keeps the fixture honest.
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, Buffer.alloc(14), sof]);
}

/** Lossy WebP: RIFF container with a VP8 frame header. */
function webpBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'latin1');
  buffer.writeUInt32LE(22, 4);
  buffer.write('WEBP', 8, 'latin1');
  buffer.write('VP8 ', 12, 'latin1');
  buffer.writeUInt32LE(10, 16);
  buffer.writeUInt8(0x9d, 23);
  buffer.writeUInt8(0x01, 24);
  buffer.writeUInt8(0x2a, 25);
  buffer.writeUInt16LE(width, 26);
  buffer.writeUInt16LE(height, 28);
  return buffer;
}

describe('readImageDimensions', () => {
  it('reads PNG dimensions from the IHDR chunk', () => {
    expect(readImageDimensions(pngBuffer(640, 480), 'png')).toEqual({ width: 640, height: 480 });
  });

  it('reads JPEG dimensions from the start-of-frame marker', () => {
    expect(readImageDimensions(jpegBuffer(1280, 720), 'jpeg')).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it('reads lossy WebP dimensions', () => {
    expect(readImageDimensions(webpBuffer(320, 240), 'webp')).toEqual({ width: 320, height: 240 });
  });

  it('refuses a corrupt or truncated header instead of guessing', () => {
    const truncated = pngBuffer(640, 480).subarray(0, 12);
    expect(readImageDimensions(truncated, 'png')).toBeNull();
    expect(readImageDimensions(Buffer.alloc(4096), 'jpeg')).toBeNull();
    expect(readImageDimensions(Buffer.from('not an image at all'), 'webp')).toBeNull();
  });

  it('refuses a zero-sized canvas', () => {
    expect(readImageDimensions(pngBuffer(0, 10), 'png')).toBeNull();
  });

  it('does not treat another kind as an image', () => {
    expect(readImageDimensions(pngBuffer(10, 10), 'xlsx')).toBeNull();
  });
});

describe('detectKind', () => {
  it('detects the accepted image formats by signature only', () => {
    expect(detectKind(pngBuffer(1, 1))).toBe('png');
    expect(detectKind(jpegBuffer(1, 1))).toBe('jpeg');
    expect(detectKind(webpBuffer(1, 1))).toBe('webp');
  });

  it('rejects an SVG that pretends to be an image by extension', () => {
    expect(detectKind(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(
      'unknown',
    );
  });

  it('detects PDF, MP4 and WebM signatures for content operations', () => {
    expect(detectKind(Buffer.from('%PDF-1.7\n'))).toBe('pdf');
    expect(
      detectKind(
        Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(8)]),
      ),
    ).toBe('mp4');
    expect(detectKind(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('webm');
  });
});

describe('content upload purposes', () => {
  it('allows factory media videos and credential documents', () => {
    expect(PURPOSE_RULES['factory-media-video']).toEqual({
      kind: 'video',
      extensions: ['.mp4', '.webm'],
    });
    expect(PURPOSE_RULES['credential-document']?.kind).toBe('document');
    expect(PURPOSE_RULES['credential-document']?.extensions).toContain('.pdf');
  });
});
