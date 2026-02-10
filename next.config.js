/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  images: {
    domains: [],
  },
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
  },
}

module.exports = nextConfig
