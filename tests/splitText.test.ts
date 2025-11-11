import { describe, expect, it } from "@jest/globals";
import { splitText } from "../utils/text.utils.ts";

describe("splitText", () => {
  it("forces a split when the \\split command is present", () => {
    const result = splitText("Hello\\splitWorld", 100);
    expect(result).toEqual(["Hello", "World"]);
  });

  it("removes the \\split command from the output", () => {
    const result = splitText("Part 1 \\split Part 2", 100);
    expect(result).toEqual(["Part 1 ", " Part 2"]);
    const recombined = result.join("");
    expect(recombined).toBe("Part 1  Part 2");
    expect(recombined).not.toContain("\\split");
  });

  it("continues to respect the max length within each forced segment", () => {
    const result = splitText("AAAAAAAAAA\\splitBBBBBBBBBB", 4);
    expect(result).toEqual(["AAAA", "AAAA", "AA", "BBBB", "BBBB", "BB"]);
  });

  it("handles consecutive split commands without creating empty chunks", () => {
    const result = splitText("First\\split\\splitSecond", 100);
    expect(result).toEqual(["First", "Second"]);
  });
});
