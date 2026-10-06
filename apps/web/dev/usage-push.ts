// The usage push (#428): how Railway's `develop` dev server comes to hold a
// history it could never scan for itself.
//
// Railway serves `/__dev/usage` from `vite dev` (#314), but the transcripts a
// scan reads are on the developer's laptop, so a scan there finds none. The
// laptop therefore sends what its own history holds — `bun run tokens --push
// <url>` — and Railway stores it in its history file, on a volume
// (`USAGE_HISTORY_FILE`), where its own scans tally it exactly as the laptop's
// do. Nothing new is computed on either side: the rows go into the same
// `response` table with the same per-id dedupe a local scan uses, so pushing
// twice is pushing once, and "History since" is the same `MIN(at)`.
//
// **Rows, not transcripts, and both ends are held to it.** `buildPush` copies
// the six fields of a stored response by name rather than spreading the row,
// and the dev server accepts only `usagePushSchema` — strict, so an extra key
// is a 400 rather than a stored column. `usage-push.test.ts` asserts the
// payload's keys and that a transcript's text and paths are absent from it.
//
// The wire is `../src/dev/usage-push.ts`; this is the node half of both ends,
// so the push's sending side is testable here — `scripts/` has no runner. The
// one call it leaves to `scripts/issue-tokens.ts` is the `fetch` itself.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import {
  FORECAST_PREFIX,
  ISSUES_FILE_ENV,
  type IssueMetadata,
} from "./issues.ts";
import { BASIC_AUTH_ENV } from "./basic-auth.ts";
import { openUsageStore } from "./usage-store.ts";
import { DEVTOOLS_API } from "../src/dev/devtools-paths.ts";
import {
  usagePushSchema,
  type PushedIssue,
  type UsagePush,
  type UsagePushResult,
} from "../src/dev/usage-push.ts";

/**
 * The largest body the dev server reads. A row is ~150 bytes of JSON, so this
 * is a history of ~400k responses; this machine's first scan was ~14k. Not a
 * measured ceiling — a bound, so a runaway client cannot fill the container's
 * memory.
 */
export const MAX_PUSH_BYTES = 64 * 1024 * 1024;

/**
 * What the laptop sends: every response its history holds, and the listing it
 * scanned against.
 *
 * Every stored row, not only those since the last push. The server's per-id
 * dedupe makes that safe and the payload a few MB, and a client that tracked
 * what it had sent would be a second cursor that could drift from the store.
 *
 * The listing is rebuilt from `IssueMetadata` into `gh`'s own shape, so the
 * file the server writes parses through `fetchIssueMetadata` like a real
 * listing. Of the labels, only the one this repo reads — the forecast band —
 * goes; `gh`'s colours and descriptions never leave.
 */
export async function buildPush(
  historyFile: string,
  metadata: IssueMetadata,
): Promise<UsagePush> {
  const store = await openUsageStore(historyFile);
  try {
    return {
      // By name, not `...row`: a column added to the store later does not
      // reach the wire by accident.
      responses: store
        .responses()
        .map(({ id, session, branch, at, out, cacheRead }) => ({
          id,
          session,
          branch,
          at,
          out,
          cacheRead,
        })),
      issues: metadata.byIssue
        ? [...metadata.byIssue].map(([number, meta]): PushedIssue => ({
            number,
            title: meta.title,
            state: meta.state,
            url: meta.url,
            labels: meta.forecast
              ? [{ name: `${FORECAST_PREFIX}${meta.forecast}` }]
              : [],
          }))
        : null,
    };
  } finally {
    store.close();
  }
}

/** A push's answer: the counts, or why nothing was stored. */
export type PushOutcome =
  | { status: 200; body: UsagePushResult }
  | { status: 400 | 409 | 413; body: { error: string } };

/**
 * Store a push in this server's history, and its listing where
 * `GH_ISSUES_FILE` points.
 *
 * Validated whole before anything is written, so a rejected push leaves the
 * history as it was — no file is even created. A push carrying a listing this
 * server has nowhere to keep is refused the same way (409) rather than half
 * applied: without `GH_ISSUES_FILE` the page would ask `gh`, which the dev
 * image does not have, and every row would score as unforecast.
 *
 * The listing is written to a temporary file and renamed over the old one, so a
 * scan reading it at that moment sees one listing or the other, never half.
 */
export async function acceptPush(
  body: unknown,
  historyFile: string,
  issuesFile: string | null,
): Promise<PushOutcome> {
  const parsed = usagePushSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: `Not a usage push: ${z.prettifyError(parsed.error)}`,
      },
    };
  }
  const { responses, issues } = parsed.data;
  if (issues && !issuesFile) {
    return {
      status: 409,
      body: {
        error: `This push carries an issue listing and ${ISSUES_FILE_ENV} is not set, so there is nowhere to keep it. Nothing was stored.`,
      },
    };
  }

  const store = await openUsageStore(historyFile);
  let inserted: number;
  try {
    const before = store.count();
    store.record(responses);
    inserted = store.count() - before;
  } finally {
    store.close();
  }

  if (issues && issuesFile) {
    mkdirSync(dirname(issuesFile), { recursive: true });
    const partial = `${issuesFile}.partial`;
    writeFileSync(partial, JSON.stringify(issues), "utf8");
    renameSync(partial, issuesFile);
  }

  return {
    status: 200,
    body: {
      received: responses.length,
      inserted,
      issues: issues?.length ?? null,
    },
  };
}

/** A body that ran past `MAX_PUSH_BYTES`. */
class TooLarge extends Error {}

/** The request body as text, refusing to buffer more than the limit. */
async function readBody(req: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > MAX_PUSH_BYTES) throw new TooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The handler's whole job, given the request stream: read, parse, store.
 * What the plugin registers on `DEVTOOLS_API.usagePush`.
 */
export async function receivePush(
  req: AsyncIterable<Buffer | string>,
  historyFile: string,
  issuesFile: string | null,
): Promise<PushOutcome> {
  let text: string;
  try {
    text = await readBody(req);
  } catch (err) {
    if (!(err instanceof TooLarge)) throw err;
    return {
      status: 413,
      body: { error: `A push is at most ${MAX_PUSH_BYTES} bytes.` },
    };
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (err) {
    return {
      status: 400,
      body: {
        error: `Not JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
  return acceptPush(body, historyFile, issuesFile);
}

/**
 * Where `bun run tokens --push <url>` posts, and with what credential.
 *
 * Only the URL's origin is kept, so the page's own address
 * (`…/__dev/usage`) works as well as the bare host. The develop server sits
 * behind Basic Auth (#314), and the credential comes from the URL's userinfo —
 * moved into a header, since `fetch` refuses a URL that carries one — or else
 * from `DEV_BASIC_AUTH_USERNAME`/`_PASSWORD`, the two variables the server is
 * configured with. Neither set is a local dev server, which has no gate.
 */
export function pushRequest(
  target: string,
  env: Record<string, string | undefined> = process.env,
): { endpoint: string; headers: Record<string, string> } {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new Error(
      `--push takes the dev server's URL, such as https://web.example.app; got "${target}".`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`--push takes an http(s) URL; got "${target}".`);
  }

  const username = url.username
    ? decodeURIComponent(url.username)
    : (env[BASIC_AUTH_ENV.username] ?? "");
  const password = url.password
    ? decodeURIComponent(url.password)
    : (env[BASIC_AUTH_ENV.password] ?? "");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (username || password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }
  return {
    endpoint: new URL(DEVTOOLS_API.usagePush, url.origin).href,
    headers,
  };
}
