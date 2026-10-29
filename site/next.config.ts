import type { NextConfig } from 'next'

// Static export for GitHub Pages: https://clovis500c.github.io/music-app/ (project page, hence the base path).
const config: NextConfig = {
  output: 'export',
  basePath: process.env.NODE_ENV === 'production' ? '/music-app' : '',
  images: { unoptimized: true },
  trailingSlash: true,
}

export default config
