/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { devToolsPlugin } from "./dev/plugin";

/**
 * The page's Content-Security-Policy, one directive per entry.
 *
 * This is containment, not the primary defence. Message bodies render as React
 * text nodes and the API never sends the inbound `htmlBody` at all — it is left
 * out of `MESSAGE_SELECT` in `apps/api/src/routes/tickets.ts` and out of the
 * `ThreadMessage` wire type, so attacker-supplied email markup cannot reach the
 * DOM today. This is what limits the damage on the day some future change makes
 * that untrue.
 *
 * `apiOrigin` is where the API lives: a separate origin in production, empty in
 * dev and in tests where Vite proxies `/api`. It has to be listed or every
 * request the app makes is blocked.
 *
 * `sentryOrigin` is the same story with a sharper failure mode: an unlisted
 * ingest host means the browser blocks every error report, and the only trace is
 * a CSP violation in the console of the session that broke — so the tool meant
 * to tell you about failures fails silently, in exactly the case you needed it.
 * Empty when `VITE_SENTRY_DSN` is unset, which is also when nothing tries to
 * send.
 */
function cspDirectives(apiOrigin: string, sentryOrigin: string): string[] {
  const connectSources = ["'self'", apiOrigin, sentryOrigin].filter(Boolean);

  return [
    "default-src 'self'",
    // The directive that would actually stop an XSS. It costs nothing here: the
    // built index.html loads one external module script and carries no inline
    // script of its own, so no nonce or hash plumbing is needed. Check that is
    // still true of `dist/index.html` before relaxing this.
    "script-src 'self'",
    // Inline *styles* have to be allowed, and are a far weaker vector. shadcn's
    // chart wrapper injects a <style> element for the per-chart colour
    // variables, and Radix, Recharts and sonner all write style attributes as
    // they position and animate things. Without 'unsafe-inline' every popover,
    // toast and chart in the app breaks.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    // Geist is bundled by @fontsource-variable and emitted into /assets, so
    // there is no font CDN to allow.
    "font-src 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
}

/**
 * `VITE_API_URL` reduced to a bare origin, which is the only form a CSP source
 * accepts. Empty when the API is same-origin — either unset (dev, behind the
 * proxy) or a relative path, both of which `'self'` already covers.
 */
function apiOriginFrom(apiUrl: string): string {
  if (!apiUrl) return "";
  try {
    return new URL(apiUrl).origin;
  } catch {
    return "";
  }
}

/**
 * The ingest origin out of a Sentry DSN.
 *
 * A DSN is a URL whose userinfo is the public key —
 * `https://<key>@o0.ingest.de.sentry.io/123` — and `URL.origin` drops that,
 * which is what makes this safe to put in a header: the CSP names the host, not
 * the key. Region-specific by nature (`.us.`, `.de.`), so this is derived from
 * the configured DSN rather than a wildcard guessed at.
 */
function sentryOriginFrom(dsn: string): string {
  if (!dsn) return "";
  try {
    return new URL(dsn).origin;
  } catch {
    return "";
  }
}

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
      cwd: __dirname,
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
    readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
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
  const policy = cspDirectives(apiOrigin, sentryOrigin)
    .filter((directive) => !directive.startsWith("frame-ancestors"))
    .join("; ");

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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname);
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
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Only the framework is pinned to its own chunk. Everything else is left
          // to Rollup, which splits per dynamic import — so each lazy route in
          // App.tsx already gets its own chunk, and hand-listing them here would
          // just fight that. React and the router change on their own schedule
          // (rarely), so holding them apart keeps app edits from busting the
          // cache entry that costs the most to re-download.
          //
          // The subpaths are listed, not just the package names: these entries are
          // matched against resolved module ids, and `react-dom` does not cover
          // `react-dom/client` (what main.tsx imports) or `react/jsx-runtime` (what
          // the JSX transform emits). Listing only the bare names silently leaves
          // all of react-dom in the entry chunk — which is exactly what happened
          // the first time. If this list is edited, check the built `vendor-*.js`
          // is still ~130 kB and not ~50 kB.
          manualChunks: {
            vendor: [
              "react",
              "react/jsx-runtime",
              "react-dom",
              "react-dom/client",
              "react-router-dom",
            ],
          },
        },
      },
    },
    server: {
      port: 4000,
      proxy: {
        "/api": "http://localhost:3001",
      },
    },
    // `vite preview` is the only place this repo serves a build itself, so it is
    // the only place the policy can be delivered the way production should
    // deliver it: as a header, `frame-ancestors` included. Treat this as the
    // reference for whatever host ends up serving `dist/` — the meta tag in the
    // page is the fallback for hosts that cannot set headers, not a substitute.
    preview: {
      headers: {
        "Content-Security-Policy": cspDirectives(apiOrigin, sentryOrigin).join(
          "; ",
        ),
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
