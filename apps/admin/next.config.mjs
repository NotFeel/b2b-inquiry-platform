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
    // to the API, so split-host deployments do not depend on browser CORS and
    // do not bake `localhost` into the client bundle.
    const target = (
      process.env.ADMIN_API_PROXY_TARGET ??
      process.env.API_BASE_URL ??
      'http://localhost:3002'
    ).replace(/\/+$/, '');
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
