/** @type {import("jest").Config} **/
export default {
  preset: "ts-jest",
  testEnvironment: "node",
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
  coverageProvider: "v8", // or “babel”
  coverageDirectory: "coverage",
  coverageReporters: ["json-summary"]
};
