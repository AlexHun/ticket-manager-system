import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeSuites } from "./suites.ts";

// The develop image is built through the root `.dockerignore`, which leaves out
// `playwright.config.ts` and `tests/`. Playwright without its config loads every
// Bun and Vitest file in the repo as a spec and ends "No tests found" (#585),
// so the page is told the suite cannot run there rather than offered it.

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "suites-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const e2e = () => describeSuites(root).find((suite) => suite.id === "e2e")!;

describe("describeSuites", () => {
  it("marks the E2E suite unavailable, naming what is missing, when its config and specs are absent", () => {
    expect(e2e().unavailable).toContain("playwright.config.ts");
    expect(e2e().unavailable).toContain("tests/e2e");
  });

  it("offers the E2E suite when both are there", () => {
    writeFileSync(join(root, "playwright.config.ts"), "");
    mkdirSync(join(root, "tests/e2e"), { recursive: true });
    expect(e2e().unavailable).toBeNull();
  });

  it("names only the path that is missing", () => {
    writeFileSync(join(root, "playwright.config.ts"), "");
    expect(e2e().unavailable).not.toContain("playwright.config.ts");
    expect(e2e().unavailable).toContain("tests/e2e");
  });

  it("offers every suite that needs no file of its own, whatever the tree holds", () => {
    expect(
      describeSuites(root)
        .filter((suite) => suite.id !== "e2e")
        .map((suite) => suite.unavailable),
    ).toEqual([null, null, null]);
  });
});
