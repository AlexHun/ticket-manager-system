import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherUsage } from "./usage.ts";
import {
  ISSUE_STATE,
  fetchIssueMetadata,
  ISSUES_FILE_ENV,
  type IssueMetadata,
} from "./issues.ts";
import { openUsageStore } from "./usage-store.ts";
import {
  MAX_PUSH_BYTES,
  acceptPush,
  buildPush,
  pushRequest,
  receivePush,
} from "./usage-push.ts";
import { PUSHED_RESPONSE_FIELDS } from "../src/dev/usage-push.ts";
import { DEVTOOLS_API } from "../src/dev/devtools-paths.ts";
import { BASIC_AUTH_ENV } from "./basic-auth.ts";

/**
 * The usage push (#428): the laptop's history rows, and its issue listing, sent
 * to Railway's `develop` dev server, which has no transcripts of its own.
 *
 * The two machines are two history files here, and the Railway one is read over
 * a transcript directory that does not exist â€” which is what that server's
 * `~/.claude/projects/â€¦` is.
 */

let work: string;
let transcripts: string;
let laptop: string;
let railway: string;
let listingFile: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "usage-push-"));
  transcripts = join(work, "transcripts");
  laptop = join(work, "laptop.sqlite");
  railway = join(work, "railway.sqlite");
  listingFile = join(work, "railway-issues.json");
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** The text a transcript holds and a push must never carry. */
const SECRET = "the prompt the developer typed";

/** A response Claude Code wrote, prompt text and all. */
const record = (id: string, branch: string, out: number, timestamp: string) =>
  JSON.stringify({
    sessionId: "s1",
    gitBranch: branch,
    timestamp,
    cwd: "C:\\Users\\dev\\project",
    message: {
      id,
      content: [{ type: "text", text: SECRET }],
      usage: { output_tokens: out, cache_read_input_tokens: 7 },
    },
  });

const listing = (): IssueMetadata => ({
  byIssue: new Map([
    [
      101,
      {
        title: "Spent on",
        url: "https://github.com/o/r/issues/101",
        state: ISSUE_STATE.closed,
        forecast: "M",
      },
    ],
    [
      102,
      {
        title: "Over",
        url: "https://github.com/o/r/issues/102",
        state: ISSUE_STATE.open,
        forecast: "S",
      },
    ],
    [
      103,
      {
        title: "Not started",
        url: "https://github.com/o/r/issues/103",
        state: ISSUE_STATE.open,
        forecast: null,
      },
    ],
  ]),
  warning: null,
});

/** A laptop history holding three responses, scanned the way `bun run tokens`
 *  scans before it pushes. */
async function scanOnLaptop() {
  mkdirSync(transcripts, { recursive: true });
  writeFileSync(
    join(transcripts, "s1.jsonl"),
    [
      record("m1", "feat/101-a", 80_000, "2026-09-02T09:00:00.000Z"),
      record("m2", "feat/102-b", 90_000, "2026-09-03T09:00:00.000Z"),
      record("m3", "main", 500, "2026-09-04T09:00:00.000Z"),
    ].join("\n"),
    "utf8",
  );
  return gatherUsage(transcripts, listing(), laptop);
}

/** What Railway's page reads after a push: its own history, no transcripts,
 *  and the listing the push wrote. */
async function scanOnRailway() {
  return gatherUsage(
    join(work, "no-transcripts-here"),
    await fetchIssueMetadata({ [ISSUES_FILE_ENV]: listingFile }),
    railway,
  );
}

describe("buildPush", () => {
  it("carries the six response fields and nothing else", async () => {
    await scanOnLaptop();

    const payload = await buildPush(laptop, listing());

    expect(Object.keys(payload).sort()).toEqual(["issues", "responses"]);
    expect(payload.responses).toHaveLength(3);
    for (const row of payload.responses) {
      expect(Object.keys(row).sort()).toEqual(
        [...PUSHED_RESPONSE_FIELDS].sort(),
      );
    }
    for (const issue of payload.issues ?? []) {
      expect(Object.keys(issue).sort()).toEqual([
        "labels",
        "number",
        "state",
        "title",
        "url",
      ]);
    }
    // Nothing the transcript said, and not where it was written either.
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain(SECRET);
    expect(wire).not.toContain("Users");
  });

  it("sends the listing as gh prints it, the forecast as its label", async () => {
    await scanOnLaptop();

    const { issues } = await buildPush(laptop, listing());

    expect(issues).toContainEqual({
      number: 101,
      title: "Spent on",
      state: ISSUE_STATE.closed,
      url: "https://github.com/o/r/issues/101",
      labels: [{ name: "forecast/M" }],
    });
    expect(issues?.find((i) => i.number === 103)?.labels).toEqual([]);
  });

  it("sends no listing when the laptop had none", async () => {
    await scanOnLaptop();

    const { issues } = await buildPush(laptop, {
      byIssue: null,
      warning: "no gh",
    });

    expect(issues).toBeNull();
  });
});

describe("acceptPush", () => {
  it("lets Railway's page report what the laptop's does, with no transcripts", async () => {
    const local = await scanOnLaptop();

    const outcome = await acceptPush(
      await buildPush(laptop, listing()),
      railway,
      listingFile,
    );
    const remote = await scanOnRailway();

    expect(outcome).toEqual({
      status: 200,
      body: { received: 3, inserted: 3, issues: 3 },
    });
    expect(remote.transcripts).toBe(0);
    expect(remote.issues).toEqual(local.issues);
    expect(remote.unattributed).toEqual(local.unattributed);
    expect(remote.historySince).toBe(local.historySince);
    // The day's point is scored, not a gap: the listing came with the rows.
    expect(remote.trend).toHaveLength(1);
    expect(remote.trend[0]?.scored).toBe(2);
    expect(remote.trend[0]?.onTarget).toBe(local.trend[0]?.onTarget);
    // A machine with no transcripts and a history is not an error.
    expect(remote.warnings).toEqual([]);
  });

  it("changes nothing when the same rows are pushed twice", async () => {
    await scanOnLaptop();
    const payload = await buildPush(laptop, listing());

    await acceptPush(payload, railway, listingFile);
    const once = await scanOnRailway();
    const again = await acceptPush(payload, railway, listingFile);
    const twice = await scanOnRailway();

    expect(again).toEqual({
      status: 200,
      body: { received: 3, inserted: 0, issues: 3 },
    });
    expect(twice.issues).toEqual(once.issues);
    expect(twice.historySince).toBe(once.historySince);
    expect(twice.unattributed).toEqual(once.unattributed);
  });

  it("keeps the listing it holds when a push carries none", async () => {
    await scanOnLaptop();
    await acceptPush(await buildPush(laptop, listing()), railway, listingFile);

    const outcome = await acceptPush(
      await buildPush(laptop, { byIssue: null, warning: "no gh" }),
      railway,
      listingFile,
    );

    expect(outcome.body).toMatchObject({ issues: null });
    expect((await scanOnRailway()).issues[0]?.title).toBe("Over");
  });

  const valid = {
    id: "message:m1",
    session: "s1",
    branch: "feat/101-a",
    at: "2026-09-02T09:00:00.000Z",
    out: 10,
    cacheRead: 0,
  };

  it.each([
    ["a body that is not a push", [valid]],
    ["responses that are not a list", { responses: valid, issues: null }],
    [
      "a row with a field nobody declared",
      { responses: [{ ...valid, text: SECRET }], issues: null },
    ],
    [
      "a row missing a field",
      { responses: [{ ...valid, cacheRead: undefined }], issues: null },
    ],
    ["negative tokens", { responses: [{ ...valid, out: -1 }], issues: null }],
    [
      "an id outside the three namespaces",
      { responses: [{ ...valid, id: "C:\\a.jsonl" }], issues: null },
    ],
    [
      "an issue with a field nobody declared",
      {
        responses: [valid],
        issues: [
          {
            number: 1,
            title: "t",
            state: "OPEN",
            url: "u",
            labels: [],
            body: SECRET,
          },
        ],
      },
    ],
  ])("rejects %s and stores nothing", async (_name, body) => {
    const outcome = await acceptPush(body, railway, listingFile);

    expect(outcome.status).toBe(400);
    expect(existsSync(railway)).toBe(false);
    expect(existsSync(listingFile)).toBe(false);
  });

  it("refuses a listing it has nowhere to put, before storing any row", async () => {
    await scanOnLaptop();

    const outcome = await acceptPush(
      await buildPush(laptop, listing()),
      railway,
      null,
    );

    expect(outcome.status).toBe(409);
    expect(JSON.stringify(outcome.body)).toContain(ISSUES_FILE_ENV);
    expect(existsSync(railway)).toBe(false);
  });

  it("stores rows without a listing when none is sent, file or no file", async () => {
    await scanOnLaptop();

    const outcome = await acceptPush(
      await buildPush(laptop, { byIssue: null, warning: "no gh" }),
      railway,
      null,
    );

    expect(outcome.status).toBe(200);
    const store = await openUsageStore(railway);
    try {
      expect(store.count()).toBe(3);
    } finally {
      store.close();
    }
  });
});

describe("receivePush", () => {
  const request = (chunks: string[]) =>
    Readable.from(chunks.map((c) => Buffer.from(c)));

  it("reads the body in chunks and stores it", async () => {
    await scanOnLaptop();
    const json = JSON.stringify(await buildPush(laptop, listing()));
    const half = Math.floor(json.length / 2);

    const outcome = await receivePush(
      request([json.slice(0, half), json.slice(half)]),
      railway,
      listingFile,
    );

    expect(outcome.status).toBe(200);
  });

  it("answers a body that is not JSON with a 400", async () => {
    const outcome = await receivePush(request(["{nope"]), railway, listingFile);

    expect(outcome.status).toBe(400);
    expect(existsSync(railway)).toBe(false);
  });

  it("stops reading past the size limit and answers 413", async () => {
    const big = "x".repeat(1024 * 1024);
    const chunks = Array.from(
      { length: Math.ceil(MAX_PUSH_BYTES / big.length) + 1 },
      () => big,
    );

    const outcome = await receivePush(request(chunks), railway, listingFile);

    expect(outcome.status).toBe(413);
  });
});

describe("pushRequest", () => {
  it("posts to the push route on the URL's origin, the credential moved to a header", () => {
    const { endpoint, headers } = pushRequest(
      "https://dev:s3cret@web.example.app/__dev/usage",
      {},
    );

    expect(endpoint).toBe(`https://web.example.app${DEVTOOLS_API.usagePush}`);
    expect(endpoint).not.toContain("s3cret");
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("dev:s3cret").toString("base64")}`,
    );
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("takes the credential from the basic-auth variables when the URL has none", () => {
    const { headers } = pushRequest("https://web.example.app", {
      [BASIC_AUTH_ENV.username]: "dev",
      [BASIC_AUTH_ENV.password]: "p@ss:word",
    });

    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("dev:p@ss:word").toString("base64")}`,
    );
  });

  it("sends no credential when there is none, for a local dev server", () => {
    const { headers } = pushRequest("http://localhost:4000", {});

    expect(headers.Authorization).toBeUndefined();
  });

  it("refuses something that is not an http(s) URL", () => {
    expect(() => pushRequest("web.example.app", {})).toThrow(/--push/);
    expect(() => pushRequest("file:///etc/passwd", {})).toThrow(/http/);
  });
});
