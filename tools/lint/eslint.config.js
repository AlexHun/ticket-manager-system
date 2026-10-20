// The lint gate: type-aware rules over the backend (#534) and the web app
// (#535), and nothing else. `docs/standards/conventions.md` has which rules,
// why they run in CI only, what a run costs and how to exempt one line;
// `docs/standards/frontend.md` has the web app's two hooks rules.
//
// This config lives in its own workspace because typescript-eslint drives the
// classic TypeScript compiler API, which TypeScript 7 no longer ships: its peer
// range stops below 6.1, and every other workspace is on 7. Bun's isolated
// linker resolves that peer against this package's own `typescript@6.0.3`, so
// the pin here changes nothing the apps compile with.
import { fileURLToPath } from "node:url";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const promiseRules = {
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": "error",
};

export default [
  {
    // Every path below is read from the repository root: the `lint` script
    // moves there before starting ESLint, because a file outside the directory
    // ESLint runs from is ignored whatever the config says.
    files: [
      "apps/api/**/*.ts",
      "apps/web/**/*.{ts,tsx}",
      "packages/core/**/*.ts",
      "packages/shared/**/*.ts",
    ],
    ignores: ["apps/api/src/generated/**", "apps/web/dist/**"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        tsconfigRootDir: repoRoot,
        projectService: {
          // The seed scripts and the Prisma CLI config sit outside every
          // tsconfig's `include`, and they are Prisma calls as much as `src`
          // is. They are read under the API's own compiler options.
          allowDefaultProject: [
            "apps/api/prisma.config.ts",
            "apps/api/prisma/*.ts",
          ],
          defaultProject: "apps/api/tsconfig.json",
        },
      },
    },
    linterOptions: {
      // An exemption that no longer exempts anything is an error, so a fixed
      // line cannot keep a stale disable comment.
      reportUnusedDisableDirectives: "error",
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: promiseRules,
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
];
