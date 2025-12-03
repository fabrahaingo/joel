import { describe, expect, it } from "@jest/globals";
import { fuzzyIncludes } from "../utils/text.utils.ts";

describe("fuzzyIncludes", () => {
  it("matches needle words appearing in order even with extra words in between", () => {
    const haystack = "corps des ingénieurs de l'armement";
    expect(fuzzyIncludes(haystack, "ingénieurs armement")).toBe(true);
  });

  it("returns false when a needle word is missing", () => {
    const haystack = "corps des ingénieurs de l'armement";
    expect(fuzzyIncludes(haystack, "ingénieurs naval")).toBe(false);
  });
});
