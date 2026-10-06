import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Next takes its dev lock inside distDir; e2e sets its own so it can run beside `bun run dev`.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Keep the dev badge clear of the rail's Log out button.
  devIndicators: { position: 'bottom-right' }
}

export default nextConfig
