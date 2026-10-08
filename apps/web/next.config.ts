import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  // Keep Clerk's same-origin rewrites on the bound host (127.0.0.1 in local dev).
  // Normalizing it to localhost makes Next proxy the request back to itself.
  skipProxyUrlNormalize: true,
  poweredByHeader: false,
};

export default nextConfig;
