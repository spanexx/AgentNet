import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/", "coverage/"],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-constant-condition": "warn",
      "@typescript-eslint/no-empty-function": "warn",
      "no-duplicate-imports": "error",
      "no-unreachable": "error",
      "no-unreachable-loop": "error",
      "no-unused-expressions": "error",
      "no-useless-return": "error",
    },
  }
);
