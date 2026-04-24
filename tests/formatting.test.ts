import { describe, expect, it } from "@jest/globals";
import { textTypeOrdre } from "../utils/formatting.utils.ts";
import { TYPE_ORDRE_VALUES } from "../types.ts";

describe("textTypeOrdre", () => {
  it("returns a non-empty string for every defined TypeOrdre value with 'M'", () => {
    for (const type of TYPE_ORDRE_VALUES) {
      const result = textTypeOrdre(type, "M");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("returns a non-empty string for every defined TypeOrdre value with 'F'", () => {
    for (const type of TYPE_ORDRE_VALUES) {
      const result = textTypeOrdre(type, "F");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("applies feminine agreement for nomination", () => {
    expect(textTypeOrdre("nomination", "F")).toContain("nommée");
    expect(textTypeOrdre("nomination", "M")).toContain("nommé");
    expect(textTypeOrdre("nomination", "M")).not.toContain("nommée");
  });

  it("applies feminine agreement for promotion", () => {
    expect(textTypeOrdre("promotion", "F")).toContain("promue");
    expect(textTypeOrdre("promotion", "M")).toContain("promu");
  });

  it("gender-neutral cases return same text for M and F", () => {
    // "cessation de fonction" uses "cessé ses fonctions" — no agreement suffix
    expect(textTypeOrdre("cessation de fonction", "F")).toBe(
      textTypeOrdre("cessation de fonction", "M")
    );
    expect(textTypeOrdre("démission", "F")).toBe(
      textTypeOrdre("démission", "M")
    );
  });

  it("all results start with the 📝 emoji and end with newline", () => {
    for (const type of TYPE_ORDRE_VALUES) {
      const result = textTypeOrdre(type, "M");
      expect(result.startsWith("📝")).toBe(true);
      expect(result.endsWith("\n")).toBe(true);
    }
  });
});
