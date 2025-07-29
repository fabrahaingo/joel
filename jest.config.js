/** @type {import("jest").Config} **/
export default {
  preset: "ts-jest",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],

  /* re‑compile plain .js so CommonJS still works in the VM */
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
    "^.+\\.jsx?$": "babel-jest"
  },

  /* Jest’s resolver adds “.js” to relative imports—strip it back off */
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },

  /* Re‑transform the ESM‑only dependency that started all this */
  transformIgnorePatterns: ["/node_modules/(?!(whatsapp-api-js)/)"],

  /* ---- your original hooks & coverage settings ---- */
  globalSetup: "<rootDir>/tests/globalSetup.ts",
  globalTeardown: "<rootDir>/tests/globalTeardown.ts",
  setupFilesAfterEnv: ["<rootDir>/tests/setupFile.ts"],

  collectCoverage: true,
  collectCoverageFrom: ["**/*.{ts,tsx}", "!**/*.d.ts"],
  coverageProvider: "v8",
  coverageDirectory: "coverage",
  coverageReporters: ["json-summary"]
};
