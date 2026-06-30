import { describe, it, expect } from "vitest";
import { formatSearchResult } from "../utils/formatSearchResult.ts";
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

describe("formatSearchResult — headers", () => {
  it("renders a markdown link header for a single confirmation result", () => {
    const msg = formatSearchResult([item()], true, { isConfirmation: true });
    expect(msg).toContain("[Jean Dupont]");
    expect(msg).toContain("dernière information");
  });

  it("renders a plain (non-markdown) link with the URL on its own line", () => {
    const msg = formatSearchResult([item()], false, { isConfirmation: true });
    expect(msg).toContain("*Jean Dupont*");
    expect(msg).toContain("https://jorfsearch.steinertriples.ch");
  });

  it("pluralises the confirmation header for multiple results", () => {
    const msg = formatSearchResult([item(), item()], true, {
      isConfirmation: true
    });
    expect(msg).toContain("2 dernières informations");
  });

  it("shows a follower count when provided", () => {
    const msg = formatSearchResult([item()], true, {
      isConfirmation: true,
      numberUserFollowing: 3
    });
    expect(msg).toContain("(3 abonnés)");
  });

  it("uses the listing header with displayName=first", () => {
    const msg = formatSearchResult([item()], true, {
      isListing: true,
      displayName: "first"
    });
    expect(msg).toContain("🕵️");
  });
});

describe("formatSearchResult — poste rendering", () => {
  it("renders a grade with cabinet", () => {
    const msg = formatSearchResult(
      [item({ grade: "Directeur", cabinet: "Premier ministre" })],
      true
    );
    expect(msg).toContain("*Directeur*");
    expect(msg).toContain("*de cabinet*");
    expect(msg).toContain("Cabinet du *Premier ministre*");
  });

  it("renders a légion d'honneur grade", () => {
    const msg = formatSearchResult(
      [item({ grade: "Chevalier", legion_honneur: true })],
      true
    );
    expect(msg).toContain("de la Légion d'honneur");
  });

  it("renders an armée grade with organisation", () => {
    const msg = formatSearchResult(
      [
        item({
          armee_grade: "Colonel",
          armee: "réserve",
          organisations: [{ nom: "Armée de terre" }]
        })
      ],
      true
    );
    expect(msg).toContain("au grade de *Colonel*");
    expect(msg).toContain("de réserve");
    expect(msg).toContain("Armée de terre");
  });

  it("renders an ambassadeur poste", () => {
    const msg = formatSearchResult(
      [item({ ambassadeur: true, ambassadeur_pays: "Italie" })],
      true
    );
    expect(msg).toContain("Ambassadeur auprès de *Italie*");
  });

  it("lists organisation names when no other poste applies", () => {
    const msg = formatSearchResult(
      [item({ organisations: [{ nom: "Conseil d'État" }] })],
      true
    );
    expect(msg).toContain("👉 *Conseil d'État*");
  });
});

describe("formatSearchResult — dates and references", () => {
  it("renders a date range", () => {
    const msg = formatSearchResult(
      [item({ date_debut: "2024-01-01", date_fin: "2024-12-31" })],
      true
    );
    expect(msg).toContain("🗓 Du");
    expect(msg).toContain("au");
  });

  it("renders an open-ended start date", () => {
    const msg = formatSearchResult([item({ date_debut: "2024-01-01" })], true);
    expect(msg).toContain("À compter du");
  });

  it("includes a source reference link unless omitted", () => {
    const withRef = formatSearchResult([item()], true);
    expect(withRef).toContain("cliquez ici");
    const omitted = formatSearchResult([item()], true, { omitReference: true });
    expect(omitted).not.toContain("cliquez ici");
  });
});
