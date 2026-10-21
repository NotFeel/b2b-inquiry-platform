/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Shared workspace packages ship TypeScript sources that Next transpiles.
  transpilePackages: ['@b2b/ui', '@b2b/contracts', '@b2b/i18n', '@b2b/validation'],
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    // Keep the inquiry POST same-origin in the browser. This avoids CORS
    // preflight for the custom session header and works for localhost, LAN IPs
    // and production domains without exposing the API host to the client.
    const target = (
      process.env.STOREFRONT_API_PROXY_TARGET ??
      process.env.API_BASE_URL ??
      'http://localhost:3002'
    ).replace(/\/+$/, '');
    return [
      {
        source: '/api/v1/public/inquiry-intents',
        destination: `${target}/api/v1/public/inquiry-intents`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
