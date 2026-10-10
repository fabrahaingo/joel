import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import semver from "semver";
import { MatrixClient } from "matrix-bot-sdk";

interface LockPackage {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface PackageJson {
  devDependencies: Record<string, string>;
  overrides: Record<string, string>;
}

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8")
) as PackageJson;
const lockPackages = (
  JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8")) as {
    packages: Partial<Record<string, LockPackage>>;
  }
).packages;

// Ranges every installed package declares for `name` (the lockfile keeps the
// declared spec even when an override replaces the resolved version).
function dependentRanges(name: string): string[] {
  return Object.entries(lockPackages)
    .filter(([path]) => path !== "")
    .flatMap(([, entry]) => [
      entry?.dependencies?.[name],
      entry?.optionalDependencies?.[name]
    ])
    .filter((range): range is string => range !== undefined);
}

describe("temporary dependency workarounds", () => {
  it.each(Object.entries(pkg.overrides))(
    "override %s@%s is still needed by some dependent",
    (name, overrideRange) => {
      const stillNeeded = dependentRanges(name).some(
        (range) => !semver.subset(range, overrideRange)
      );
      expect(
        stillNeeded,
        `Every dependent of ${name} already requires ${overrideRange}: remove the override from package.json`
      ).toBe(true);
    }
  );

  it("typescript stays pinned below the version typescript-eslint rejects", () => {
    const peer =
      lockPackages["node_modules/typescript-eslint"]?.peerDependencies
        ?.typescript;
    expect(peer).toBeDefined();
    const pinned = semver.minVersion(pkg.devDependencies.typescript);
    expect(pinned).not.toBeNull();
    const nextMinor = semver.inc(pinned ?? "", "minor") ?? "";

    expect(
      semver.satisfies(nextMinor, peer ?? ""),
      `typescript-eslint now accepts typescript ${nextMinor} (peer "${peer ?? ""}"): widen the typescript range in package.json and drop the typescript ignore in .github/dependabot.yml`
    ).toBe(false);
  });

  // utils/matrixSyncHealth.ts replaces the protected MatrixClient.doSync on the
  // instance; the SDK sync loop must still call it through `this`.
  it("matrix-bot-sdk sync loop still goes through doSync", () => {
    expect(typeof Reflect.get(MatrixClient.prototype, "doSync")).toBe(
      "function"
    );
    const source = readFileSync(
      new URL("node_modules/matrix-bot-sdk/lib/MatrixClient.js", root),
      "utf8"
    );
    expect(
      source,
      "MatrixClient no longer calls this.doSync(): attachSyncHealth in utils/matrixSyncHealth.ts records nothing"
    ).toContain("this.doSync(");
  });
});
