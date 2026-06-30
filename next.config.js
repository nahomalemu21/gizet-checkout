/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: '/checkout', destination: '/checkout.html' },
      { source: '/pay-confirm', destination: '/pay-confirm.html' },
    ]
  },
}
module.exports = nextConfig
