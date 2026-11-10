import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ürün ikonu ve kural dosyaları sunucu eylemiyle yüklenir.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
