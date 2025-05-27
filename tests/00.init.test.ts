import { describe, expect } from "@jest/globals";
import { dbHelper } from "./dbHelper";

describe("Mock DB Initialization", () => {
  beforeAll(async () => {
    await dbHelper.setup();
  });

  it("should run first", () => {
    expect(true).toBe(true);
  });
});
