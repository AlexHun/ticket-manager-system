/**
 * The express server a route test talks to (#189).
 *
 * Every route test in this workspace stands one up, and until this module they
 * each stood up their own: ten copies of the same `beforeAll` — an app, a JSON
 * body parser, one `app.use(mount, router)`, `listen(0)` on the loopback for a
 * port the OS picks, and an `afterAll` to close it — differing only in the two
 * arguments this function takes. The copies never diverged, which is the case
 * for having one of them rather than ten.
 *
 * **Port 0, not a fixed one, and that is not incidental.** `bun test` runs every
 * file in a single process, so ten files each holding a port of their own choice
 * would collide the moment two of them named the same number — and would collide
 * with whatever the developer has running on 3001 besides. The OS picks a free
 * one and `address()` reports which; nothing here has to coordinate.
 *
 * ## What it hands back
 *
 * A function that builds a URL under the mount, because that is what every
 * caller did with the origin: all twenty-odd `fetch` calls across those files
 * read `` `${origin}/api/tickets${path}` `` — the origin and the mount path
 * concatenated, the mount re-typed in each one. `url(path)` is that, once.
 *
 * It is a function rather than a string because the port does not exist until
 * `beforeAll` has run, and module scope is where the callers need the handle.
 *
 * **This is the server and nothing else.** The per-file `Sent<T>` type and the
 * `get`/`post`/`patch` helpers beside it stay where they are: each closes over
 * its own default headers and its own verbs, and one helper covering all of
 * them would be a lowest common denominator every caller then works around
 * (#189 says so explicitly, having looked).
 */

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll } from "bun:test";
import express, { type Router } from "express";

/**
 * Serve one router for the lifetime of the test file, and return a URL builder
 * for it.
 *
 * Registers its own `beforeAll` and `afterAll`, so call it at module scope
 * where the boot block used to be — the hooks run in registration order, and
 * anything else the file registers keeps the position it had.
 *
 * ```ts
 * const url = serveRouter("/api/changelog", changelogRouter);
 * // ...
 * const res = await fetch(url("/entries"), { headers: AGENT });
 * ```
 */
export function serveRouter(
  mount: string,
  router: Router,
): (path?: string) => string {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(mount, router);
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${mount}`;
  });

  afterAll(() => {
    server.close();
  });

  return (path = "") => `${base}${path}`;
}
