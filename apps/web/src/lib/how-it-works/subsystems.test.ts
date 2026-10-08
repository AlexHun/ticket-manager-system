import { describe, expect, it } from "vitest";
import { ARCHITECTURE_NODE, ARCHITECTURE_NODES } from "./architecture";
import {
  DRILLABLE_BOXES,
  SUBSYSTEMS,
  boxOf,
  isDrillable,
  linkPhrase,
  partLabel,
  subsystemsOf,
} from "./subsystems";

/** A repo path or a file name: a slash, or an extension at the end. */
const FILE_LIKE = /[\\/]|\.[a-z]{1,4}$/i;

describe("the subsystem data", () => {
  it("opens exactly the API, the job workers and the browser app", () => {
    expect(
      ARCHITECTURE_NODES.filter((node) => isDrillable(node.id)).map(
        (node) => node.id,
      ),
    ).toEqual([
      ARCHITECTURE_NODE.api,
      ARCHITECTURE_NODE.jobWorkers,
      ARCHITECTURE_NODE.browserApp,
    ]);
    for (const box of DRILLABLE_BOXES) {
      expect(subsystemsOf(box).length, box).toBeGreaterThan(0);
    }
  });

  it("gives the API the nine subsystems the grilling settled, in order", () => {
    expect(subsystemsOf(ARCHITECTURE_NODE.api).map((s) => s.title)).toEqual([
      "Ingestion",
      "Tickets & Activity",
      "Knowledge base",
      "Pipeline & Automation",
      "Outbox",
      "Auth & Users",
      "Realtime",
      "Evals & Schedule",
      "Demo",
    ]);
  });

  it("names no single file", () => {
    for (const subsystem of SUBSYSTEMS) {
      expect(subsystem.title, subsystem.id).not.toMatch(FILE_LIKE);
    }
  });

  it("gives every subsystem a unique id, and a title unique within its box", () => {
    const ids = SUBSYSTEMS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const box of DRILLABLE_BOXES) {
      const titles = subsystemsOf(box).map((s) => s.title);
      expect(new Set(titles).size, box).toBe(titles.length);
    }
  });

  it("joins each subsystem only to parts of other boxes, once each", () => {
    for (const subsystem of SUBSYSTEMS) {
      const parts = subsystem.links.map((link) => link.part);
      expect(new Set(parts).size, subsystem.id).toBe(parts.length);
      for (const part of parts) {
        expect(boxOf(part), `${subsystem.id} → ${part}`).not.toBe(
          subsystem.box,
        );
      }
      expect(subsystem.links.length, subsystem.id).toBeGreaterThan(0);
    }
  });

  it("tells a subsystem from a box of the same name by the box it is in", () => {
    expect(partLabel(ARCHITECTURE_NODE.postgres)).toBe("Postgres");
    const outbox = SUBSYSTEMS.find((s) => s.id === "outbox")!;
    expect(partLabel(outbox.id)).toBe("Outbox (API)");
    expect(linkPhrase(outbox.links[0]!)).toBe("HTTP from Browser app");
  });
});
