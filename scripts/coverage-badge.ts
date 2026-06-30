// Generates a self-hosted Shields "endpoint" badge from the vitest coverage
// summary. Run after `npm test` (which writes coverage/coverage-summary.json).
// The README references the committed JSON via img.shields.io/endpoint, so the
// badge needs no third-party coverage service.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const summaryPath = "coverage/coverage-summary.json";
const outPath = ".github/badges/coverage.json";

interface CoverageSummary {
  total: { lines: { pct: number } };
}

const summary = JSON.parse(
  readFileSync(summaryPath, "utf8")
) as CoverageSummary;
const pct = summary.total.lines.pct;

const color =
  pct >= 90
    ? "brightgreen"
    : pct >= 80
      ? "green"
      : pct >= 70
        ? "yellowgreen"
        : pct >= 60
          ? "yellow"
          : pct >= 50
            ? "orange"
            : "red";

const badge = {
  schemaVersion: 1,
  label: "coverage",
  message: `${String(pct)}%`,
  color
};

mkdirSync(".github/badges", { recursive: true });
writeFileSync(outPath, JSON.stringify(badge) + "\n");
console.log(`Wrote ${outPath}: ${badge.message} (${color})`);
