import { describe, expect, it } from "@jest/globals";
import { fuzzyIncludes } from "../utils/text.utils.ts";

const scenarios = [
  {
    needles: ["ingénieurs armement", "corps armement"],
    titles: [
      "corps des ingénieurs de l'armement",
      "recrutement exceptionnel au corps des ingénieurs de l'armement"
    ]
  },
  {
    needles: ["enseignants contractuels", "enseignants contrat"],
    titles: [
      "recrutement des enseignants contractuels du primaire",
      "liste d'aptitude pour les enseignants contractuels en académie"
    ]
  },
  {
    needles: ["médecins urgentistes", "médecine d'urgence"],
    titles: [
      "habilitation des médecins urgentistes à la régulation",
      "formation continue en médecine d'urgence hospitalière"
    ]
  }
];

describe("fuzzyIncludes", () => {
  it("matches needles within their own group and rejects titles from others", () => {
    scenarios.forEach((scenario, index) => {
      scenario.needles.forEach((needle) => {
        scenario.titles.forEach((title) => {
          expect(fuzzyIncludes(title, needle)).toBe(true);
        });

        scenarios.forEach((otherScenario, otherIndex) => {
          if (otherIndex === index) return;

          otherScenario.titles.forEach((otherTitle) => {
            expect(fuzzyIncludes(otherTitle, needle)).toBe(false);
          });
        });
      });
    });
  });
});
