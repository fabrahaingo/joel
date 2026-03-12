import { describe, expect, it } from "@jest/globals";
import { sanitizeUserInput, stripMarkdown } from "../utils/text.utils.ts";

describe("sanitizeUserInput", () => {
  it("strips characters commonly used in injection payloads", () => {
    const raw = "<script>$ne {drop: 1}</script> Salut";
    const sanitized = sanitizeUserInput(raw);

    expect(sanitized).toBe("scriptne drop: 1/script Salut");
  });

  it("removes control characters while keeping the message legible", () => {
    const raw = "Hello\u0000\u0008World$gt";
    const sanitized = sanitizeUserInput(raw);

    expect(sanitized).toBe("HelloWorldgt");
  });

  it("strips Markdown formatting characters", () => {
    const raw = "Jean *Dupont* _test_";
    const sanitized = sanitizeUserInput(raw);

    expect(sanitized).toBe("Jean Dupont test");
  });
});

describe("stripMarkdown", () => {
  it("removes Markdown formatting characters from a plain string", () => {
    expect(stripMarkdown("Commission *R.* article _4122_")).toBe(
      "Commission R. article 4122"
    );
  });

  it("removes backtick and bracket characters", () => {
    expect(stripMarkdown("`code` [link]")).toBe("code link");
  });

  it("recursively strips strings inside an object", () => {
    const input = { nom: "Org *Name*", grade: "_Colonel_" };
    const result = stripMarkdown(input);

    expect(result.nom).toBe("Org Name");
    expect(result.grade).toBe("Colonel");
  });

  it("recursively strips strings inside an array", () => {
    const input = ["*bold*", "_italic_", "plain"];
    expect(stripMarkdown(input)).toEqual(["bold", "italic", "plain"]);
  });

  it("leaves non-string primitives unchanged", () => {
    expect(stripMarkdown(42)).toBe(42);
    expect(stripMarkdown(true)).toBe(true);
    expect(stripMarkdown(null)).toBe(null);
  });
});
