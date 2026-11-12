import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,          // no dev badge over the exhibit UI (and in screenshots)
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
