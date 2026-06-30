import { describe, it, expect, vi } from "vitest";
import {
  cleanJORFItems,
  mergeJORFSearchItemCleaningStats,
  type JORFSearchItemCleaningStats
} from "../entities/JORFSearchResponse.ts";

// cleanJORFItems console.logs on unexpected enum values; keep the test output quiet.
vi.spyOn(console, "log").mockImplementation(() => undefined);

interface RawItem {
  source_date?: string;
  source_id?: string;
  source_name?: string;
  type_ordre?: string;
  nom?: string;
  prenom?: string;
  [k: string]: unknown;
}

const baseRaw = (over: RawItem = {}): RawItem => ({
  source_date: "2024-01-15",
  source_id: "JORFTEXT0001",
  source_name: "JORF",
  type_ordre: "nomination",
  nom: "Dupont",
  prenom: "Jean",
  ...over
});

const clean = (items: RawItem[]) => cleanJORFItems(items);

describe("cleanJORFItems — required-field dropping", () => {
  it("keeps a fully valid record", () => {
    const { cleanItems, processingStats } = clean([baseRaw()]);
    expect(cleanItems).toHaveLength(1);
    expect(processingStats.dropped_item_nb).toBe(0);
    expect(cleanItems[0].nom).toBe("Dupont");
  });

  it.each([
    ["source_date", "missing_source_date"],
    ["source_id", "missing_source_id"],
    ["source_name", "missing_source_name"],
    ["type_ordre", "missing_type_ordre"],
    ["nom", "missing_nom"],
    ["prenom", "missing_prenom"]
  ] as [keyof RawItem, keyof JORFSearchItemCleaningStats][])(
    "drops a record missing %s and counts it",
    (field, stat) => {
      const raw = baseRaw();
      raw[field] = undefined;
      const { cleanItems, processingStats } = clean([raw]);
      expect(cleanItems).toHaveLength(0);
      expect(processingStats[stat]).toBe(1);
      expect(processingStats.dropped_item_nb).toBe(1);
    }
  );
});

describe("cleanJORFItems — normalisation", () => {
  it("repairs known type_ordre misspellings", () => {
    const { cleanItems } = clean([
      baseRaw({ type_ordre: "admissibilite" }),
      baseRaw({ type_ordre: "conférés" })
    ]);
    expect(cleanItems.map((i) => i.type_ordre)).toEqual([
      "admissibilité",
      "conféré"
    ]);
  });

  it("uppercases organisation wikidata ids and drops nameless orgs", () => {
    const { cleanItems } = clean([
      baseRaw({
        organisations: [
          { nom: "Ministère", wikidata_id: "q123" },
          { wikidata_id: "q999" }
        ]
      })
    ]);
    expect(cleanItems[0].organisations).toHaveLength(1);
    expect(cleanItems[0].organisations[0].wikidata_id).toBe("Q123");
  });

  it("infers cabinet_ministeriel from a cabinet value", () => {
    const { cleanItems } = clean([baseRaw({ cabinet: "Ministre X" })]);
    expect(cleanItems[0].cabinet_ministeriel).toBe(true);
  });

  it("infers ambassadeur from ambassadeur_pays", () => {
    const { cleanItems } = clean([baseRaw({ ambassadeur_pays: "Italie" })]);
    expect(cleanItems[0].ambassadeur).toBe(true);
  });

  it("keeps a remplacement only when both names are present", () => {
    const withBoth = clean([
      baseRaw({ remplacement: { nom: "Martin", prenom: "Paul" } })
    ]);
    expect(withBoth.cleanItems[0].remplacement).toEqual({
      nom: "Martin",
      prenom: "Paul"
    });
    const partial = clean([baseRaw({ remplacement: { nom: "Martin" } })]);
    expect(partial.cleanItems[0].remplacement).toBeUndefined();
  });

  it("derives eleve_ena for INSP nominations (org Q109039648)", () => {
    const { cleanItems } = clean([
      baseRaw({
        type_ordre: "nomination",
        date_debut: "2023-09-01",
        organisations: [{ nom: "INSP", wikidata_id: "Q109039648" }]
      })
    ]);
    expect(cleanItems[0].eleve_ena).toBe("2023-2025");
  });
});

describe("mergeJORFSearchItemCleaningStats", () => {
  it("sums counters and recomputes dropped_item_nb", () => {
    const a: JORFSearchItemCleaningStats = {
      raw_item_nb: 10,
      clean_item_nb: 8,
      dropped_item_nb: 2,
      missing_source_date: 1,
      missing_source_id: 0,
      missing_source_name: 1,
      missing_type_ordre: 0,
      missing_nom: 0,
      missing_prenom: 0
    };
    const b: JORFSearchItemCleaningStats = {
      ...a,
      raw_item_nb: 5,
      clean_item_nb: 5,
      dropped_item_nb: 0,
      missing_source_date: 0,
      missing_source_name: 0
    };
    const merged = mergeJORFSearchItemCleaningStats([a, b]);
    expect(merged.raw_item_nb).toBe(15);
    expect(merged.clean_item_nb).toBe(13);
    expect(merged.dropped_item_nb).toBe(2);
    expect(merged.missing_source_date).toBe(1);
  });
});
