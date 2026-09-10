import { existsSync } from "node:fs";
import type { NextConfig } from "next";

const unsupportedLocalEnvironmentFiles = [
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
  ".env.test",
  ".env.test.local",
].filter((file) => existsSync(file));

if (unsupportedLocalEnvironmentFiles.length > 0) {
  throw new Error(
    `NexaPlay uses .env as its only local environment source. Remove or disable: ${unsupportedLocalEnvironmentFiles.join(
      ", ",
    )}`,
  );
}

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self' https://*.supabase.co",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
  "media-src 'self' blob: https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const productionSecurityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      'autoplay=(self "https://www.youtube.com" "https://www.youtube-nocookie.com")',
      'fullscreen=(self "https://www.youtube.com" "https://www.youtube-nocookie.com")',
    ].join(", "),
  },
] as const;

const nextConfig: NextConfig = {
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];

    return [
      {
        source: "/:path*",
        headers: [...productionSecurityHeaders],
      },
    ];
  },
};

export default nextConfig;
