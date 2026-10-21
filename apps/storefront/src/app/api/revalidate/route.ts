import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

// On-demand ISR invalidation for the public site configuration.
//
// The API calls this after a public setting changes so the storefront never
// serves a stale value beyond the request that triggered the change (docs/21
// §7.9). It is protected by a shared secret: without REVALIDATE_SECRET the
// route refuses every call and the ISR TTL stays the fallback.
// `products` covers the catalogue listing and detail caches, which carry the
// public tag badges (docs/23 §6.4).
const ALLOWED_TAGS = new Set(['site-config', 'products', 'content', 'faq']);

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    return NextResponse.json({ error: { code: 'NOT_CONFIGURED' } }, { status: 503 });
  }
  if (request.headers.get('x-revalidate-secret') !== secret) {
    return NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  }

  const tag = new URL(request.url).searchParams.get('tag');
  if (!tag || !ALLOWED_TAGS.has(tag)) {
    return NextResponse.json({ error: { code: 'UNKNOWN_TAG' } }, { status: 400 });
  }

  revalidateTag(tag);
  return NextResponse.json({ revalidated: true, tag });
}
