import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
]

const nextConfig: NextConfig = {
  // Next takes its dev lock inside distDir; e2e sets its own so it can run beside `bun run dev`.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Self-contained server for the production Docker image (`node server.js`).
  output: 'standalone',
  poweredByHeader: false,
  // Keep the dev badge clear of the rail's Log out button.
  devIndicators: { position: 'bottom-right' },
  // The Content-Security-Policy (per-request nonce) is set in src/proxy.ts.
  headers: async () => [{ source: '/:path*', headers: securityHeaders }]
}

export default nextConfig
