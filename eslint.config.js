// @ts-check

import { defineConfig } from "eslint/config";

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import prettierConfig from "eslint-config-prettier";

export default defineConfig(
  // Never lint build/coverage output. `npm run build` (tsc) emits compiled JS
  // into dist/, which the type-aware parser can't resolve and which isn't ours
  // to lint; without this, building before a commit breaks the lint hook.
  { ignores: ["dist/**", "coverage/**"] },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.js"]
        }
      }
    }
  },
  prettierConfig,
  eslintPluginPrettierRecommended,
  // Test files: `expect(obj.method)` reads a method without calling it, which
  // trips unbound-method even though vitest never re-binds `this`. This is a
  // known false positive in assertion code, so relax it for tests only.
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/unbound-method": "off"
    }
  }
);
