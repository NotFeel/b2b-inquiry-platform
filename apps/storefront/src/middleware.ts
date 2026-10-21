import { NextResponse, type NextRequest } from 'next/server';

const LOCALES = ['en-US', 'zh-CN'];
const DEFAULT_LOCALE = 'en-US';

// Locale-prefixed routes keep canonical URLs stable while the storefront ships a
// single content locale in phase one (docs/03 §1).
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/sitemap') ||
    pathname.startsWith('/robots') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }
  const matchedLocale = LOCALES.find(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
  if (matchedLocale) {
    // Pass the URL locale to the root layout so <html lang> matches the page
    // even though the root layout sits above the [locale] segment.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-storefront-locale', matchedLocale);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: ['/((?!_next|api).*)'],
};
