import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: "./tests/globalSetup.ts",
    setupFiles: ["./tests/setupFile.ts"],
    fileParallelism: false, // == jest --runInBand (forces maxWorkers 1)
    coverage: {
      provider: "v8",
      reporter: ["json-summary"],
      include: ["**/*.{ts,tsx}"],
      exclude: ["**/*.d.ts"]
    }
  }
});
