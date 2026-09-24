import js from "@eslint/js";
import security from "eslint-plugin-security";
import globals from "globals";

export default [
  { ignores: ["**/node_modules/**", "**/.wrangler/**"] },
  js.configs.recommended,
  security.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.node } },
    rules: {
      "security/detect-object-injection": "off",
      "security/detect-non-literal-fs-filename": "off",
    },
  },
  {
    files: ["src/**/*.js", "test/**/*.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["test/**/*.js"],
    rules: { "security/detect-unsafe-regex": "off", "security/detect-non-literal-regexp": "off" },
  },
];
