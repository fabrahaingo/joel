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
  eslintPluginPrettierRecommended
);
