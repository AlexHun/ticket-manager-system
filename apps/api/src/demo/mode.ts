/**
 * Demo mode: whether a visitor may sign in with no credential at all.
 *
 * **A leaf with no imports, and that is the point of the file.** `auth.ts`
 * reads it to refuse `/sign-in/anonymous`, and `auth.ts` is the module a unit
 * test cannot always load for real — `routes/*.test.ts` replace
 * `../middleware/auth`, which is how it is reached. Nothing mocks a module with
 * no dependencies, so a route test and the auth test can both read the same
 * switch without one of them being handed the other's stub (see the registry
 * hazard in `testing-api.md`).
 *
 * See `docs/adr/0022-a-demo-session-is-an-anonymous-agent.md`.
 */

/**
 * Default **off**, and only the literal `"true"` turns it on — the same shape
 * as `PIPELINE_SIMULATOR_ENABLED`, for the same reason sharpened: a deployment
 * that never thought about this must be one nobody can walk into.
 *
 * Read per call, not captured at import, so a test can flip it and so the
 * refusal follows the environment the process actually has.
 */
export function isDemoModeEnabled(): boolean {
  return process.env.DEMO_MODE_ENABLED === "true";
}

/**
 * What every demo identity is called, on the top bar and in every trail its
 * actions leave (R11). One name for all of them on purpose: a visitor is not
 * somebody the desk knows, and a name that looked personal would read as a
 * colleague in ticket history.
 */
export const DEMO_VISITOR_NAME = "Demo visitor";

/**
 * The domain a demo identity's placeholder address sits under. Reserved by
 * RFC 2606, like the simulator's `sim.example.com`, so no mail addressed to one
 * can ever reach a person. Better Auth's own default is `temp@<id>.com`, which
 * is a real top-level domain.
 */
export const DEMO_EMAIL_DOMAIN = "demo.example.com";
