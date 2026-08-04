import type { NextConfig } from "next";

// Every multipart/form-data POST — including the `/api/v1/assets` upload route —
// is size-checked against this limit before the route handler runs, and exceeding
// it returns a plain-text 413 that never reaches our JSON error handling. The
// default is 1MB, which rejected almost every attachment. Set to the Cloudflare
// per-request body ceiling so the platform, not the framework, is the only limit.
const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
