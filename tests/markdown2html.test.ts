import { describe, expect, it } from "vitest";
import { markdown2html } from "../utils/text.utils.ts";

describe("markdown2html", () => {
  it("converts a simple link", () => {
    const input = "[cliquez ici](https://example.com/page)";
    const output = markdown2html(input);
    expect(output).toBe(
      '<a href="https://example.com/page" rel="noopener noreferrer">cliquez ici</a>'
    );
  });

  it("converts italic markers", () => {
    const input = "📝 A été _nommée_";
    const output = markdown2html(input);
    expect(output).toBe("📝 A été <em>nommée</em>");
  });

  it("converts bold markers", () => {
    const input = "👉 *Conseiller*";
    const output = markdown2html(input);
    expect(output).toBe("👉 <strong>Conseiller</strong>");
  });

  it("does not treat underscore in URL as italic marker", () => {
    const input =
      "[Cabinet ministeriel](https://jorfsearch.steinertriples.ch/tag/cabinet_ministeriel)";
    const output = markdown2html(input);
    expect(output).toBe(
      '<a href="https://jorfsearch.steinertriples.ch/tag/cabinet_ministeriel" rel="noopener noreferrer">Cabinet ministeriel</a>'
    );
  });

  it("preserves underscore in URL when followed by italic text", () => {
    const input = [
      "[Cabinet ministeriel](https://jorfsearch.steinertriples.ch/tag/cabinet_ministeriel)",
      "📝 A été _nommée_"
    ].join("\n");
    const output = markdown2html(input);
    // URL must contain the underscore intact
    expect(output).toContain("cabinet_ministeriel");
    // The italic must be properly rendered
    expect(output).toContain("<em>nommée</em>");
    // No unformatted italic markers should remain in the output
    expect(output).not.toContain("_nommée_");
    expect(output).not.toContain("nommée_");
  });

  it("correctly renders italic after a link with underscore in URL and italic source reference", () => {
    const input = [
      "[Cabinet ministeriel](https://jorfsearch.steinertriples.ch/tag/cabinet_ministeriel)",
      "🔗 _JORF du 19 fevrier 2026_: [cliquez ici](https://bodata.steinertriples.ch/JORFTEXT/redirect)",
      "[Pauline Silhol-Bertrand](https://jorfsearch.steinertriples.ch/name/Pauline%20Silhol-Bertrand)",
      "📝 A été _nommée_"
    ].join("\n");
    const output = markdown2html(input);
    expect(output).toContain("cabinet_ministeriel");
    expect(output).toContain("<em>JORF du 19 fevrier 2026</em>");
    expect(output).toContain("<em>nommée</em>");
    // No unformatted italic markers or stray trailing underscores
    expect(output).not.toContain("_nommée_");
    expect(output).not.toContain("nommée_");
  });

  it("converts newlines to <br />", () => {
    const input = "line1\nline2";
    const output = markdown2html(input);
    expect(output).toBe("line1<br />line2");
  });
});
