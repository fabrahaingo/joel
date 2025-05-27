import { dbHelper } from "./dbHelper";

describe("Final Cleanup", () => {
  afterAll(async () => {
    await dbHelper.cleanup();
  });

  it("should run last", () => {
    expect(true).toBe(true);
  });
});
