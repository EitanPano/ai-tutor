import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Keep the dev badge clear of the rail's Log out button.
  devIndicators: { position: 'bottom-right' }
}

export default nextConfig
