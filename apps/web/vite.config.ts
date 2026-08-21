/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { devToolsPlugin } from "./dev/plugin.ts";
import {
  apiOriginFrom,
  cspMetaPolicy,
  cspPolicy,
  sentryOriginFrom,
} from "./csp.ts";

/**
 * A git command, or an empty string if git cannot answer.
 *
 * Every caller must tolerate the empty string: a deployment built from a
 * tarball, a Docker context without `.git`, or a machine with no git installed
 * are all normal, and none of them is a reason to fail a build. `stdio` silences
 * git's own stderr so those cases don't print an alarming line during a build
 * that is going to succeed anyway.
 */
function git(...args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: import.meta.dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * The release name reported to Sentry — the "version" half of narrowing an issue
 * down to the code that produced it, with `environment` as the other half.
 *
 * Format is Sentry's own convention, `project@version`, so their UI groups and
 * sorts these the way it expects to. The package version alone would be useless
 * here — this is a private workspace pinned at `0.0.0` and nobody bumps it — so
 * the commit is what actually identifies the build, and the version is kept in
 * front of it for the day that changes.
 *
 * `-dirty` is not decoration. A release name is a claim that these errors came
 * from that commit, and a build made over uncommitted edits is a different
 * program wearing the same sha; without the marker, the one build you cannot
 * reproduce is the one that looks most trustworthy. Untracked files are excluded
 * — `.env` and `.vite/` are always there and say nothing about the code.
 */
function releaseName(): string {
  const { version } = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8"),
  ) as { version: string };

  const commit = git("rev-parse", "--short", "HEAD");
  if (!commit) return `web@${version}`;

  // No pathspec, so this is the whole repo rather than this workspace — right,
  // because `packages/core` and `packages/shared` end up in this bundle too.
  const dirty = git("status", "--porcelain", "--untracked-files=no")
    ? "-dirty"
    : "";
  return `web@${version}+${commit}${dirty}`;
}

/**
 * Ships the CSP inside the document.
 *
 * A meta tag rather than a response header because nothing in this repo serves
 * the build: `vite build` emits a static `dist/` and the host is whatever it
 * gets deployed to. A header configured for one host would not survive a move,
 * whereas the tag travels with the page. If the eventual host can set headers,
 * setting the same policy there too is strictly better — a real header also
 * carries `frame-ancestors`, which meta tags cannot express (browsers ignore it
 * there and log a warning), so it is filtered out below and only set on the
 * `preview` server.
 *
 * Build-only: Vite's dev server injects the React Refresh preamble and its HMR
 * client as inline scripts, which `script-src 'self'` blocks outright.
 */
function cspPlugin(apiOrigin: string, sentryOrigin: string): Plugin {
  const policy = cspMetaPolicy(apiOrigin, sentryOrigin);

  return {
    name: "ticket:csp-meta",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: policy,
          },
          // Ahead of every tag it governs, which is the only position a meta
          // CSP is honoured in.
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

/**
 * Writes the policy out as a Caddy header field, for the production web server.
 *
 * `apps/web/Caddyfile` imports this file *inside* its `header` block — Caddy's
 * `import` splices tokens in wherever it appears — so the deployed SPA is served
 * with the *real* header rather than only the meta tag above. That is what
 * `frame-ancestors` needs, and what `CLAUDE.md` has been asking for
 * ("Production hosting must set that header").
 *
 * Generated rather than written by hand for the reason at the top of `csp.ts`:
 * the policy depends on `VITE_API_URL` and `VITE_SENTRY_DSN`, both of which are
 * build inputs, so a static Caddyfile could only ever hold a stale guess at
 * them. A deployment that points at a new API origin would serve a header
 * blocking every request the freshly built bundle makes.
 *
 * It lands beside the Caddyfile rather than inside `dist/`, because `dist/` is
 * `file_server`'d wholesale and this is server configuration, not an asset.
 * Gitignored — it is build output.
 */
function cspCaddyPlugin(apiOrigin: string, sentryOrigin: string): Plugin {
  const policy = cspPolicy(apiOrigin, sentryOrigin);
  const outFile = path.resolve(import.meta.dirname, "csp.caddy");

  return {
    name: "ticket:csp-caddy",
    apply: "build",
    closeBundle() {
      writeFileSync(
        outFile,
        [
          "# Generated by vite.config.ts — do not edit.",
          "# Source of truth: apps/web/csp.ts",
          `Content-Security-Policy "${policy}"`,
          "",
        ].join("\n"),
        "utf8",
      );
    },
  };
}

/**
 * A directory-safe name for one `VITE_API_URL`, for `cacheDir` below.
 *
 * Empty is the production and dev shape — the app calls its own origin through
 * the Caddy proxy — and it has to produce a name rather than an empty segment,
 * hence the fallback. Everything else collapses to letters, digits and dashes,
 * so `http://localhost:3002` becomes `http-localhost-3002`: still readable in a
 * directory listing, which matters the day someone is wondering why there are
 * three of these.
 */
function cacheKeyFor(apiUrl: string): string {
  const slug = apiUrl
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "same-origin";
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname);
  const apiOrigin = apiOriginFrom(env.VITE_API_URL ?? "");
  const sentryOrigin = sentryOriginFrom(env.VITE_SENTRY_DSN ?? "");

  // The commit is not an environment variable anybody sets — it has to be asked
  // of git at the moment the bundle is produced, which is here. It reaches the
  // app by being written into the environment Vite is about to read: `loadEnv`
  // runs after this function and takes `VITE_*` keys from `process.env`, so this
  // arrives as an ordinary `import.meta.env` value.
  //
  // **Not `define`.** That is the documented tool for exactly this and it does
  // not work in dev: `vite:define` returns early for client code whenever the
  // command isn't `build` (node_modules/vite/dist/node/chunks/dep-Dq2t6Dq0.js,
  // the `consumer === "client" && !isBuild` guard), and nothing injects the
  // global the docs promise in its place. A `define`d constant therefore builds
  // fine and throws `ReferenceError` the moment you run `bun run dev` — measured
  // here, not guessed. `import.meta.env` is the one channel that behaves the same
  // in dev, in a build and under Vitest.
  //
  // Only when nothing supplied one already: an exported `VITE_SENTRY_RELEASE` or
  // one in a `.env` file is a deliberate override (a CI tag, a build number) and
  // is left alone. `env` above holds both, which is why the check reads it rather
  // than `process.env`.
  if (!env.VITE_SENTRY_RELEASE) {
    process.env.VITE_SENTRY_RELEASE = releaseName();
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Backs the two pages under /__dev: the project map and the test runner.
      // `apply: "serve"` inside, so this contributes nothing to a build — see the
      // note at the top of dev/plugin.ts.
      devToolsPlugin(),
      cspPlugin(apiOrigin, sentryOrigin),
      cspCaddyPlugin(apiOrigin, sentryOrigin),
      // Writes a treemap of the production bundle on every build — the only way
      // to tell whether a dependency actually ships or merely looks like it does.
      // Recharts reaches the bundle through a namespace import in shadcn's chart
      // wrapper, which tree-shakes unpredictably; this is what settles it.
      //
      // Lands in `.vite/` rather than `dist/`: it is a build report, not an
      // asset, and `dist` is what gets deployed. `.vite` is already gitignored.
      visualizer({
        filename: ".vite/stats.html",
        gzipSize: true,
        brotliSize: true,
      }),
    ],
    // One dependency cache per API origin, instead of one shared by everything.
    //
    // **This is what keeps the E2E suite startable.** Vite invalidates the
    // optimizer cache when the config changes, `VITE_API_URL` is part of this
    // config (it decides `connect-src` and the axios baseURL), and the E2E run
    // uses a different value from the dev server: empty for `bun run dev`,
    // `http://localhost:3002` for Playwright. Sharing `node_modules/.vite` meant
    // each run invalidated the other's cache, so whichever started next paid a
    // full re-optimize — **measured at 299,581ms on this project**, against a
    // `webServer.timeout` of 120,000. The suite could not start, and the error
    // named the timeout rather than the cause. Running the two alternately made
    // it ping-pong: every run re-optimized, forever.
    //
    // Keyed on the origin rather than on a boolean, so a third arrangement
    // (pointing the dev server at a deployed API, say) gets its own cache too
    // instead of joining a queue behind the other two.
    cacheDir: `node_modules/.vite/${cacheKeyFor(env.VITE_API_URL ?? "")}`,
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Only the framework is pinned to its own chunk. Everything else is left
          // to the bundler, which splits per dynamic import — so each lazy route in
          // App.tsx already gets its own chunk, and hand-listing them here would
          // just fight that. React and the router change on their own schedule
          // (rarely), so holding them apart keeps app edits from busting the
          // cache entry that costs the most to re-download.
          //
          // **Function form, not the object form, and that is forced.** Vite 8
          // bundles with Rolldown, whose `manualChunks` accepts only a callback;
          // the `{ vendor: [...] }` map this replaced is Rollup-only and fails
          // typecheck outright under Vite 8 (TS2769 — "provides no match for the
          // signature"). It is a rename of the mechanism, not of the intent.
          //
          // What changed with it: the old form listed *module ids*, so subpaths
          // had to be spelled out (`react-dom` did not cover `react-dom/client`,
          // nor `react` cover `react/jsx-runtime`, and omitting them silently
          // left all of react-dom in the entry chunk). Matching the resolved
          // path instead covers every subpath of a package at once, so the
          // subpath entries are gone rather than lost. `scheduler` is now named
          // explicitly because the old form pulled it in as a dependency of
          // react-dom for free, and a path match gets nothing for free.
          //
          // The trailing separator in each alternative is load-bearing: without
          // it `react` also matches `react-router-dom`, `react-hook-form` and
          // every other `react-*` package in node_modules, which quietly turns
          // this into a single-vendor-chunk build. If this list is edited, check
          // the built `vendor-*.js` is still ~230 kB and not ~50 kB (too little:
          // react-dom escaped) or ~600 kB (too much: the guard above failed).
          manualChunks(id) {
            return /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(
              id,
            )
              ? "vendor"
              : undefined;
          },
        },
      },
    },
    server: {
      port: 4000,
      proxy: {
        // Overridable so a dev server can be pointed at another API without
        // editing this file. No `VITE_` prefix: it is server-side routing and has
        // no business in the client bundle. The E2E suite does *not* use it — it
        // sets `VITE_API_URL` instead, deliberately, because that is what keeps
        // its dependency cache separate from this one (see `cacheDir` above).
        "/api": process.env.DEV_API_PROXY ?? "http://localhost:3001",
      },
    },
    // `vite preview` serves a build the way production should serve it: as a
    // header, `frame-ancestors` included. It is no longer the *only* place that
    // happens — `apps/web/Caddyfile` sets the same policy from the same source
    // on the deployed service — so treat this as the local rehearsal of it. The
    // meta tag in the page is the fallback for hosts that cannot set headers,
    // not a substitute.
    preview: {
      headers: {
        "Content-Security-Policy": cspPolicy(apiOrigin, sentryOrigin),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      css: false,
      // Vitest's default is 5s, and the heaviest specs here sit just under it:
      // a test that opens two Radix Selects and clicks through the results is
      // several seconds of jsdom on its own, before any parallel load. That put
      // the tickets-list specs in the position where an ordinary change — one
      // more column, one more control in the filter bar — tipped passing tests
      // into timeouts that looked like logic failures and were not.
      //
      // 15s is chosen to absorb that variance while still failing fast on a
      // genuine hang; nothing here legitimately takes more than a few seconds.
      testTimeout: 15_000,
    },
  };
});
