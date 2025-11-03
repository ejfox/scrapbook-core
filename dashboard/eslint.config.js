import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "app.js", // Old demo file
      "demo.html", // Old demo file
    ],
  },
  js.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      "no-console": "off",
      "semi": ["warn", "always"],
      "quotes": ["warn", "double", { avoidEscape: true }],
      "indent": ["warn", 2],
      "comma-dangle": ["warn", "always-multiline"],
      "no-multiple-empty-lines": ["warn", { max: 2 }],
      "eol-last": ["warn", "always"],
      "no-trailing-spaces": "warn",
      "vue/html-indent": ["warn", 2],
      "vue/max-attributes-per-line": ["warn", {
        singleline: 3,
        multiline: 1,
      }],
      "vue/multi-word-component-names": "off",
    },
  },
];
