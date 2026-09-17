import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "coverage/**"],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
