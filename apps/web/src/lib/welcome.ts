/**
 * The welcome's names a test reaches for: the page heading, the suggested
 * steps' heading, the control that leaves it and the banner's link back
 * (demo-welcome PRD, R1, R4, R6, R7).
 *
 * Import-free, like `routes.ts`, so `tests/e2e/demo-welcome.spec.ts` imports
 * them rather than restating them — a retyped label would leave the spec
 * looking for a control that no longer exists.
 */
export const WELCOME_LABEL = {
  title: "Welcome to the demo",
  stepsHeading: "Where to start",
  startExploring: "Start exploring",
  bannerLink: "About this demo",
} as const;
