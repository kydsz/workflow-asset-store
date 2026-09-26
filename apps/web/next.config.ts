import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@was/core'],
  experimental: {
    serverActions: {
      // 上传图/视频走 uploadIngest Server Action，默认 1MB 上限会拒掉大文件；留出 multipart 开销余量
      bodySizeLimit: '100mb',
    },
  },
};

export default config;
