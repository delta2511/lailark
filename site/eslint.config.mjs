import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    ignores: [".next/**", "out/**", "node_modules/**", "playwright-report/**", "test-results/**"],
  },
];

export default config;
