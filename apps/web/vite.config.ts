/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
