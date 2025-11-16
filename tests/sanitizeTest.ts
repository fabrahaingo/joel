import { describe, expect, it } from "@jest/globals";
import { sanitizeUserInput } from "../utils/text.utils.ts";

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
});
