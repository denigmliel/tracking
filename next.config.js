/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['mammoth', 'pdf-parse'],
  },
}

module.exports = nextConfig
