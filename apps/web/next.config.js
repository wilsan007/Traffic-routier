/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@trafficguard/shared'],
  images: {
    remotePatterns: [{ protocol: 'http', hostname: '**' }, { protocol: 'https', hostname: '**' }],
  },
};

module.exports = nextConfig;
