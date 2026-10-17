import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: path.resolve('.'),
  experimental: { optimizePackageImports: ['lucide-react'], workerThreads: true, webpackBuildWorker: false, useTypeScriptCli: false, cpus: 2 },
  async headers() { return [{ source: '/(.*)', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
  ] }]; }
};
export default config;
