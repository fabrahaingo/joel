import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Only run the TypeScript sources under tests/. Without this, a prior
    // `tsc` build leaves compiled copies in dist/tests/*.test.js that vitest
    // would also pick up — running every suite twice and racing the two copies
    // on the shared in-memory MongoDB (dropDatabase wiping the other mid-test).
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    globalSetup: "./tests/globalSetup.ts",
    setupFiles: ["./tests/setupFile.ts"],
    fileParallelism: false, // == jest --runInBand (forces maxWorkers 1)
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["**/*.{ts,tsx}"],
      // Entrypoints (start a server / bot loop on import), one-off ops scripts,
      // dev tools, and the Signal device-linking script (top-level process.exit)
      // are run-on-import / dev-only — not sensible unit-test targets. Exclude
      // them so coverage reflects the testable business logic.
      exclude: [
        "**/*.d.ts",
        "apps/**",
        "scripts/**",
        "local_tools/**",
        "utils/connectSignal.ts",
        "tests/**",
        "eslint.config.js",
        "dist/**",
        "matrix/**"
      ]
    }
  }
});
