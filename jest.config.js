/** @type {import("jest").Config} **/
export default {
  preset: "ts-jest",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  globalSetup: "<rootDir>/tests/globalSetup.ts",
  globalTeardown: "<rootDir>/tests/globalTeardown.ts",
  setupFilesAfterEnv: ["<rootDir>/tests/setupFile.ts"],
  collectCoverage: true,
  collectCoverageFrom: [
    "*.{ts,tsx}",
    "**/*.{ts,tsx}",
    "**/**/*.{ts,tsx}",
    "!src/**/*.d.ts"
  ],
  coverageProvider: "v8",
  coverageDirectory: "coverage",
  coverageReporters: ["json-summary"]
};
