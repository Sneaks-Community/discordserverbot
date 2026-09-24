import eslint from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import jsdocPlugin from "eslint-plugin-jsdoc";
import nPlugin from "eslint-plugin-n";
import unicornPlugin from "eslint-plugin-unicorn";
import perfectionistPlugin from "eslint-plugin-perfectionist";

export default [
  {
    ignores: [
      "node_modules/**",
      "*.min.js",
      "package-lock.json",
      "db.sqlite",
      "eslint.config.js"
    ]
  },
  eslint.configs.recommended,

  {
    plugins: {
      "@stylistic": stylistic,
      jsdoc: jsdocPlugin,
      n: nPlugin,
      unicorn: unicornPlugin,
      perfectionist: perfectionistPlugin
    },
    languageOptions: {
      globals: {
        console: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        process: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly"
      }
    },
    rules: {
      // ── Style Rules ──────────────────────────────────────────────
      "@stylistic/eol-last": "error",
      "@stylistic/indent": ["error", 4],
      "@stylistic/linebreak-style": ["error", "unix"],
      "@stylistic/no-trailing-spaces": "error",
      "@stylistic/quotes": ["error", "double"],
      "@stylistic/semi": ["error", "always"],

      // ── Core Best Practices ──────────────────────────────────────
      "no-unused-vars": "error",
      "no-undef": "error",
      "no-eval": "error",
      "no-console": "error",
      "no-prototype-builtins": "error",
      "no-shadow": "error",
      "prefer-const": "error",
      "require-await": "warn",

      // ── Node.js Rules (eslint-plugin-n) ──────────────────────────
      "n/no-missing-import": "warn",
      // Checked despite "private": production installs with --omit=dev, so a devDependency import crashes it.
      "n/no-unpublished-import": ["warn", { ignorePrivate: false }],
      "n/no-process-exit": "off",

      // ── Import Rules (replaced import/order with perfectionist) ──
      "perfectionist/sort-imports": ["error", {
        groups: [
          "builtin",
          "external",
          "internal",
          ["parent", "sibling"],
          "index"
        ],
        newlinesBetween: 1,
        type: "alphabetical",
        order: "asc"
      }],

      // ── Object Sorting (eslint-plugin-perfectionist) ─────────────
      "perfectionist/sort-objects": ["error", {
        type: "alphabetical",
        order: "asc",
        ignoreCase: false
      }],

      // ── Unicorn Rules (eslint-plugin-unicorn) ────────────────────
      // String operations
      "unicorn/prefer-string-starts-ends-with": "error",
      "unicorn/prefer-string-trim-start-end": "error",
      "unicorn/prefer-includes": "error",

      // Array operations
      "unicorn/prefer-array-some": "error",
      "unicorn/prefer-array-find": "error",
      "unicorn/prefer-spread": "error",

      // Object operations
      "unicorn/prefer-object-from-entries": "error",

      // Modern patterns
      "unicorn/prefer-ternary": ["error", "only-single-line"],
      "unicorn/prefer-switch": "error",
      "unicorn/no-negated-condition": "error",
      "unicorn/consistent-function-scoping": "warn",

      // Escape sequences (replaces no-useless-escape)
      "unicorn/better-regex": "error",
      "unicorn/no-useless-undefined": "error",

      // ── Legacy rules (superseded by unicorn) ─────────────────────
      "no-useless-escape": "warn",

      // ── JSDoc Rules (eslint-plugin-jsdoc) ────────────────────────
      // Every function that takes parameters documents all of them, with a
      // type. Descriptions are optional, so a param whose name already says it
      // needs no prose. Callbacks are exempt: the contexts below target named
      // declarations and constructors only, not inline arrow functions.
      "jsdoc/check-alignment": "error",
      // Catches both a dotted @param with no declared parent and a block that
      // documents only some of a signature.
      "jsdoc/check-param-names": "error",
      "jsdoc/check-property-names": "error",
      "jsdoc/check-tag-names": "error",
      "jsdoc/check-types": "error",
      "jsdoc/empty-tags": "error",
      "jsdoc/no-multi-asterisks": "error",
      "jsdoc/no-undefined-types": ["warn", {
        definedTypes: ["ConfigError", "NodeJS", "ReadonlyArray"]
      }],
      "jsdoc/require-jsdoc": ["error", {
        contexts: [
          "FunctionDeclaration[params.length>0]",
          "MethodDefinition[value.params.length>0]"
        ],
        require: {
          ArrowFunctionExpression: false,
          ClassDeclaration: false,
          ClassExpression: false,
          FunctionDeclaration: false,
          FunctionExpression: false,
          MethodDefinition: false
        }
      }],
      "jsdoc/require-param": "error",
      // Off on purpose: "@param {string} map_name - The map name" is noise.
      "jsdoc/require-param-description": "off",
      "jsdoc/require-param-name": "error",
      "jsdoc/require-param-type": "error",
      "jsdoc/require-property-name": "error",
      // Only fires on a function that actually returns a value, so a void
      // helper needs nothing. Description optional, as with @param.
      "jsdoc/require-returns": "error",
      "jsdoc/require-returns-description": "off",
      "jsdoc/require-returns-type": "error",
      "jsdoc/valid-types": "error",

      // ── Pino logging convention (see src/utils/logger.js) ────────
      // Pino reads the first argument as the message and any further arguments
      // as printf interpolation values. Without a %s placeholder those extras
      // are discarded, so `logger.error("Failed:", err)` throws the error and
      // its stack away. Require the object-first form: logger.error({ err }, "Failed").
      // Note: if placeholder-style logging is ever adopted, these need an exception.
      "no-restricted-syntax": ["error",
        {
          selector: "CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/][arguments.length>1][arguments.0.type=/^(Literal|TemplateLiteral)$/]",
          message: "Pino discards extra args without a %s placeholder. Use logger.error({ err }, \"message\") instead."
        },
        {
          selector: "CallExpression[callee.name=/^(trace|debug|info|warn|error|fatal)$/][arguments.length>1][arguments.0.type=/^(Literal|TemplateLiteral)$/]",
          message: "Pino discards extra args without a %s placeholder. Use logger.error({ err }, \"message\") instead."
        }
      ]
    }
  }
];
