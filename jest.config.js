/** @type {import("jest").Config} **/
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
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
