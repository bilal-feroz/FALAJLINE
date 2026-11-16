import type { NextConfig } from "next";

// The browser only ever talks to this Next.js server. Requests to /api/* are proxied to the FastAPI backend,
// which is the only process that holds the Meteomatics credentials.
const BACKEND = process.env.FALAJLINE_BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  devIndicators: false,
  rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND}/api/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
