import type { RoutePath } from "../routes";

/**
 * What every node and step on How it works says about the code behind it (R4):
 * the repo paths a reader would open first, and the app screen it can be seen
 * on, where there is one.
 *
 * `code` is checked by `apps/web/dev/how-it-works-paths.test.ts`, which fails
 * CI when a path no longer exists from the repo root (R5). `screen` is read
 * from `ROUTE`, never retyped, and must be a path the sidebar links to
 * (`./screens.test.ts`): the panel names the screen after its nav item, and
 * asks the same question the sidebar does about whether this viewer may open
 * it.
 *
 * Import-free apart from a type from `../routes`, which is import-free itself,
 * so the data modules that use it stay readable from the E2E.
 */
export interface InTheCode {
  /** Repo-root-relative paths, forward slashes, at least one. */
  readonly code: readonly string[];
  /** The app screen this part can be seen on, from `ROUTE`. */
  readonly screen?: RoutePath;
}
