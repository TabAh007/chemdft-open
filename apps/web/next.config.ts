import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  distDir: process.env.CHEMDFT_WEB_DIST_DIR ?? ".next",
  reactStrictMode: true,
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  transpilePackages: ["@chemdft/ui", "@chemdft/domain", "@chemdft/i18n", "@chemdft/scientific-scene"],
  images: {
    unoptimized: true,
  },
  experimental: {
    authInterrupts: true,
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/en",
        permanent: true,
      },
    ];
  },
  async headers() {
    const contactCsp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
      "frame-src 'self' https://challenges.cloudflare.com",
      "connect-src 'self' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/:locale(en|tr|ru|de)?/contact",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contactCsp,
          },
        ],
      },
      {
        source: "/contact",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contactCsp,
          },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
