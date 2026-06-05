/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export — the `out/` directory is what gets deployed to Cloudflare Pages.
  // To upgrade to SSR later, remove this line and add the @cloudflare/next-on-pages
  // adapter.
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
};

export default nextConfig;
