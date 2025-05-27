const Sequencer = require("@jest/test-sequencer").default;

class CustomSequencer extends Sequencer {
  sort(tests) {
    // Return array of tests sorted in the order you want them to run
    return tests.sort((testA, testB) => {
      const fileA = testA.path;
      const fileB = testB.path;

      // Ensure user tests run first
      if (fileA.includes("00.init.test")) return -1;
      if (fileB.includes("00.init.test")) return 1;

      // Ensure cleanup runs last
      if (fileA.includes("99.cleanup.test")) return 1;
      if (fileB.includes("99.cleanup.test")) return -1;

      // Otherwise, use numbering/alphabetical order
      return fileA.localeCompare(fileB);
    });
  }
}

module.exports = CustomSequencer;
