/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        https: false,
        http: false,
        stream: false,
        crypto: false,
        util: false,
        buffer: false,
        zlib: false,
        url: false,
      };
      config.resolve.alias = {
        ...config.resolve.alias,
        "node:fs": false,
        "node:path": false,
        "node:https": false,
        "node:http": false,
        "node:stream": false,
        "node:crypto": false,
        "node:util": false,
        "node:buffer": false,
        "node:zlib": false,
        "node:url": false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
