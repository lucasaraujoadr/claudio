import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fontes e logos lidos com fs em runtime precisam entrar no bundle das rotas de distribuição.
  outputFileTracingIncludes: {
    '/api/distribuicao/**': ['./assets/fontes/**', './public/logo-og.png', './public/logo-og-claro.png'],
  },
  /* config options here */
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
