import { describe, expect, it } from "vitest";
import { ARCHITECTURE_NODE, ARCHITECTURE_NODES } from "./architecture";
import {
  DRILLABLE_BOXES,
  SUBSYSTEMS,
  isDrillable,
  linkPhrase,
  linkPhrasesFor,
  part,
  subsystem,
  SUBSYSTEM,
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
    for (const inside of SUBSYSTEMS) {
      const ids = inside.links.map((link) => link.part);
      expect(new Set(ids).size, inside.id).toBe(ids.length);
      for (const id of ids) {
        expect(part(id).box, `${inside.id} → ${id}`).not.toBe(inside.box);
      }
      expect(inside.links.length, inside.id).toBeGreaterThan(0);
    }
  });

  it("tells a subsystem from a box of the same name by the box it is in", () => {
    expect(part(ARCHITECTURE_NODE.postgres).label).toBe("Postgres");
    const outbox = subsystem(SUBSYSTEM.outbox);
    expect(part(outbox.id).label).toBe("Outbox (API)");
    expect(linkPhrase(outbox.links[0]!)).toBe("HTTP from Browser app");
  });

  it("tells a part of another box's links from its own side", () => {
    // Inside the job workers, the API's Outbox hands Send email a job and
    // takes the Auto-reply's reply.
    expect(
      linkPhrasesFor(ARCHITECTURE_NODE.jobWorkers, SUBSYSTEM.outbox),
    ).toEqual(["reply from Auto-reply", "job to Send email"]);
    expect(
      linkPhrasesFor(ARCHITECTURE_NODE.jobWorkers, SUBSYSTEM.sendEmailJob),
    ).toEqual(subsystem(SUBSYSTEM.sendEmailJob).links.map(linkPhrase));
  });
});
