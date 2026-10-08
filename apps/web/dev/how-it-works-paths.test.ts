import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARCHITECTURE_NODES } from "../src/lib/how-it-works/architecture.ts";
import type { InTheCode } from "../src/lib/how-it-works/code.ts";
import { LIFECYCLE_STEPS } from "../src/lib/how-it-works/lifecycle.ts";
import { SUBSYSTEMS } from "../src/lib/how-it-works/subsystems.ts";

/**
 * R5 of `docs/prd/how-it-works.md`: every repo path How it works shows exists.
 * A rename or a deletion that leaves a box, subsystem or lifecycle step
 * pointing at nothing fails here, naming the node and the path, rather than on
 * the page in front of a visitor.
 *
 * Here rather than beside the data in `src/lib/how-it-works/`, because it reads
 * the file system: `tsconfig.app.json` carries no Node types, and giving it
 * them would type `process` and `node:fs` as available to browser code. `dev/`
 * is checked by `tsconfig.node.json`, which has them, and Vitest runs both.
 */

/** This file is two directories below the repo root. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** Everything that carries "In the code", named as a failure should name it. */
const NAMED: [string, InTheCode][] = [
  ...ARCHITECTURE_NODES.map((node): [string, InTheCode] => [
    `box ${node.id}`,
    node,
  ]),
  ...SUBSYSTEMS.map((subsystem): [string, InTheCode] => [
    `subsystem ${subsystem.id}`,
    subsystem,
  ]),
  ...LIFECYCLE_STEPS.map((step): [string, InTheCode] => [
    `lifecycle step ${step.id}`,
    step,
  ]),
];

describe("How it works' code paths", () => {
  it("resolves the repo root where it expects it", () => {
    expect(existsSync(path.join(REPO_ROOT, "CLAUDE.md"))).toBe(true);
  });

  it("lists at least one path for every box, subsystem and lifecycle step", () => {
    const bare = NAMED.filter(([, part]) => part.code.length === 0).map(
      ([name]) => name,
    );
    expect(bare).toEqual([]);
  });

  it("lists only paths that exist from the repo root", () => {
    const missing = NAMED.flatMap(([name, part]) =>
      part.code
        .filter((file) => !existsSync(path.join(REPO_ROOT, file)))
        .map((file) => `${name}: ${file}`),
    );
    expect(missing).toEqual([]);
  });

  it("writes every path repo-relative, with forward slashes", () => {
    const malformed = NAMED.flatMap(([name, part]) =>
      part.code
        .filter((file) => /^[./\\]|\\|\.\./.test(file))
        .map((file) => `${name}: ${file}`),
    );
    expect(malformed).toEqual([]);
  });
});
