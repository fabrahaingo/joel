const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    ...tsJestTransformCfg,
  },
  collectCoverage: true,
  collectCoverageFrom: ['*.{ts,tsx}','**/*.{ts,tsx}','**/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  coverageProvider: 'v8',                 // or “babel”
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  globalSetup: '<rootDir>/tests/jest.global_setup.ts',
  globalTeardown: '<rootDir>/tests/jest.global_teardown.ts',
  testSequencer: '<rootDir>/tests/testSequencer.ts',
  runner: "jest-serial-runner"
};

