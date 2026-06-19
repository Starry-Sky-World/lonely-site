/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  async headers() {
    return [
      {
        // 图片资源：缓存 3 天
        source: '/images/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=259200',
          },
        ],
      },
      {
        // 图标资源：缓存 3 天
        source: '/icons/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=259200',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
