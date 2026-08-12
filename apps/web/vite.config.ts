/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";
import path from "node:path";
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
    },
  };
});
