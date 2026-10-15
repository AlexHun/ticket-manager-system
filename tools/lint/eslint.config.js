// The backend lint gate (#534): two type-aware rules and nothing else, over
// the three backend workspaces. `docs/standards/conventions.md` has which rules,
// why they run in CI only, what a run costs and how to exempt one line.
//
// This config lives in its own workspace because typescript-eslint drives the
// classic TypeScript compiler API, which TypeScript 7 no longer ships: its peer
// range stops below 6.1, and every other workspace is on 7. Bun's isolated
// linker resolves that peer against this package's own `typescript@6.0.3`, so
// the pin here changes nothing the apps compile with.
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default [
  {
    // Every path below is read from the repository root: the `lint` script
    // moves there before starting ESLint, because a file outside the directory
    // ESLint runs from is ignored whatever the config says.
    files: [
      "apps/api/**/*.ts",
      "packages/core/**/*.ts",
      "packages/shared/**/*.ts",
    ],
    ignores: ["apps/api/src/generated/**"],
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
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
];
