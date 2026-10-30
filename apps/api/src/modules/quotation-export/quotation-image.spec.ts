import { describe, expect, it } from 'vitest';
import { detectQuotationImage } from './quotation-image';

describe('detectQuotationImage', () => {
  it('detects a PNG signature and dimensions', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=',
      'base64',
    );
    expect(detectQuotationImage(png)).toEqual({ extension: 'png', width: 1, height: 1 });
  });

  it('rejects SVG and arbitrary bytes even if they claim to be images', () => {
    expect(detectQuotationImage(Buffer.from('<svg></svg>'))).toBeNull();
    expect(detectQuotationImage(Buffer.from([0xff, 0xd8, 0x00]))).toBeNull();
  });
});
