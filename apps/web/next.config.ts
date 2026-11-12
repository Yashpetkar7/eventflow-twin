import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,          // no dev badge over the exhibit UI (and in screenshots)
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Security headers on every page and asset (public demo). No CSP yet: the 3D scene and Next's inline bootstrap would
  // need nonces — see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
      ],
    }];
  },
};

export default nextConfig;
