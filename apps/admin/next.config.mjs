/** @type {import('next').NextConfig} */
const nextConfig = {
  // `next build` and `next dev` must never write into the same output folder.
  // A production build used to replace the running dev server's `.next`, which
  // left the server listening but unable to answer requests.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@b2b/ui', '@b2b/contracts', '@b2b/i18n', '@b2b/validation'],
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    // Browser requests stay on the admin origin. The Next server forwards them
    // to the API, so split-host deployments do not depend on browser CORS.
    // This value is resolved during the build and baked into the rewrite rules.
    const configuredTarget = process.env.ADMIN_API_PROXY_TARGET ?? process.env.API_BASE_URL;
    const rawTarget =
      configuredTarget ?? (process.env.NODE_ENV === 'development' ? 'http://localhost:3002' : '');
    if (!rawTarget) {
      throw new Error(
        'Production admin builds require ADMIN_API_PROXY_TARGET or API_BASE_URL to point to the API origin.',
      );
    }
    const target = rawTarget.replace(/\/+$/, '');
    return [{ source: '/api/v1/:path*', destination: `${target}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default nextConfig;
