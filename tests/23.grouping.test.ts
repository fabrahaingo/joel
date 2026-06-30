import { describe, it, expect } from "vitest";
import {
  groupRecordsBy,
  orderGroupedEntries,
  formatGroupedRecords,
  createFieldGrouping,
  createReferenceGrouping
} from "../notifications/grouping.ts";
import type { JORFSearchItem } from "../entities/JORFSearchResponse.ts";

const item = (over: Partial<JORFSearchItem> = {}): JORFSearchItem => ({
  source_date: "2024-01-15",
  source_id: "JORFTEXT0001",
  source_name: "JORF",
  type_ordre: "nomination",
  nom: "Dupont",
  prenom: "Jean",
  organisations: [],
  ...over
});

describe("groupRecordsBy", () => {
  it("groups by a single field value", () => {
    const cfg = createFieldGrouping((r) => r.type_ordre);
    const grouped = groupRecordsBy(
      [item({ type_ordre: "nomination" }), item({ type_ordre: "promotion" })],
      cfg
    );
    expect([...grouped.keys()]).toEqual(["nomination", "promotion"]);
  });

  it("places a record under every id when the accessor returns an array", () => {
    const cfg = createFieldGrouping(() => ["a", "b"]);
    const grouped = groupRecordsBy([item()], cfg);
    expect(grouped.get("a")).toHaveLength(1);
    expect(grouped.get("b")).toHaveLength(1);
  });

  it("uses the fallback label when no valid id is produced", () => {
    const cfg = createFieldGrouping(() => null, { fallbackLabel: "Autres" });
    const grouped = groupRecordsBy([item()], cfg);
    expect([...grouped.keys()]).toEqual(["Autres"]);
  });

  it("trims ids and drops empty ones", () => {
    const cfg = createFieldGrouping(() => "  spaced  ");
    const grouped = groupRecordsBy([item()], cfg);
    expect([...grouped.keys()]).toEqual(["spaced"]);
  });

  it("drops a record entirely when neither id nor fallback resolves", () => {
    const cfg = createFieldGrouping(() => "   ");
    const grouped = groupRecordsBy([item()], cfg);
    expect(grouped.size).toBe(0);
  });
});

describe("orderGroupedEntries", () => {
  it("preserves insertion order with no sort", () => {
    const map = new Map([
      ["b", [item()]],
      ["a", [item()]]
    ]);
    expect(orderGroupedEntries(map).map(([k]) => k)).toEqual(["b", "a"]);
  });

  it("applies a custom sort", () => {
    const map = new Map([
      ["b", [item()]],
      ["a", [item()]]
    ]);
    const sorted = orderGroupedEntries(map, (ids) => [...ids].sort());
    expect(sorted.map(([k]) => k)).toEqual(["a", "b"]);
  });
});

describe("formatGroupedRecords", () => {
  const leaf = (records: JORFSearchItem[]) =>
    records.map((r) => `- ${r.nom}\n`).join("");
  const sep = () => "---\n";

  it("renders titles, leaf content and separators between groups", () => {
    const cfg = createFieldGrouping((r) => r.type_ordre);
    const grouped = groupRecordsBy(
      [
        item({ type_ordre: "nomination", nom: "A" }),
        item({ type_ordre: "promotion", nom: "B" })
      ],
      cfg
    );
    const out = formatGroupedRecords(grouped, cfg, false, leaf, sep);
    expect(out).toContain("👉 nomination");
    expect(out).toContain("- A");
    expect(out).toContain("---"); // separator between the two groups
  });

  it("returns an empty string when there are no records", () => {
    const cfg = createFieldGrouping((r) => r.type_ordre);
    expect(formatGroupedRecords(new Map(), cfg, false, leaf, sep)).toBe("");
  });

  it("recurses into sub-groupings", () => {
    const cfg = createFieldGrouping((r) => r.type_ordre, {
      subGrouping: createFieldGrouping((r) => r.nom)
    });
    const grouped = groupRecordsBy(
      [item({ type_ordre: "nomination", nom: "A" })],
      cfg
    );
    const out = formatGroupedRecords(grouped, cfg, false, leaf, sep);
    expect(out).toContain("👉 nomination");
    expect(out).toContain("👉 A");
  });
});

describe("createReferenceGrouping", () => {
  it("formats a reference title with a markdown link", () => {
    const cfg = createReferenceGrouping();
    const grouped = groupRecordsBy([item({ source_id: "JORFTEXT0001" })], cfg);
    const out = formatGroupedRecords(
      grouped,
      cfg,
      true,
      (r) => r.map((x) => x.nom).join(""),
      () => ""
    );
    expect(out).toContain("📰");
    expect(out).toContain("cliquez ici");
  });

  it("sorts references by descending source date", () => {
    const cfg = createReferenceGrouping();
    const grouped = groupRecordsBy(
      [
        item({ source_id: "OLD", source_date: "2024-01-01" }),
        item({ source_id: "NEW", source_date: "2024-06-01" })
      ],
      cfg
    );
    const ordered = orderGroupedEntries(grouped, cfg.sortGroupIds);
    expect(ordered.map(([k]) => k)).toEqual(["NEW", "OLD"]);
  });
});
