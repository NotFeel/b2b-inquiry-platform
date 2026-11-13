import { describe, expect, it } from 'vitest';
import { publicHomepageQuerySchema } from './public-schemas';

describe('public homepage query', () => {
  it('defaults locale and accepts an opaque base64url cursor', () => {
    expect(publicHomepageQuerySchema.parse({})).toEqual({ locale: 'en-US' });
    expect(
      publicHomepageQuerySchema.parse({
        locale: 'zh-CN',
        cursor: 'eyJ2ZXJzaW9uIjoxLCJraW5kIjoibmV3LWFycml2YWxzIn0',
      }),
    ).toEqual({
      locale: 'zh-CN',
      cursor: 'eyJ2ZXJzaW9uIjoxLCJraW5kIjoibmV3LWFycml2YWxzIn0',
    });
  });

  it('does not accept a caller-controlled batch size', () => {
    const result = publicHomepageQuerySchema.parse({ pageSize: 600, batchSize: 600 });
    expect(result).toEqual({ locale: 'en-US' });
  });

  it.each(['', '   ', 'not+a+cursor', 'not/a/cursor', 'cursor with spaces', 'a'.repeat(1025)])(
    'rejects malformed cursor %j before a database read',
    (cursor) => {
      expect(publicHomepageQuerySchema.safeParse({ cursor }).success).toBe(false);
    },
  );
});
