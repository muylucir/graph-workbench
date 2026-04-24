/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  transpilePackages: [
    '@cloudscape-design/components',
    '@cloudscape-design/component-toolkit',
  ],
  typescript: { ignoreBuildErrors: true },
  turbopack: {
    root: new URL('.', import.meta.url).pathname,
  },
};

export default nextConfig;
