/**
 * The product's name, in its two lengths.
 *
 * `BRAND_NAME` is what the lockup reads, what every sentence says and what the
 * invitation, reset and auto-reply emails sign off as (an agent's own reply
 * signs with the agent's name); `BRAND_SHORT` is for where space is
 * tight, which today is only the browser tab. `apps/web/index.html` carries the
 * short form as a literal, because the static shell is read before any module
 * runs, and `tests/e2e/brand.spec.ts` holds the two together. Anywhere else in
 * `apps/api` or `apps/web`, a typed name fails `apps/api/src/standards-guard.test.ts`
 * (#545) unless its `BRAND_ALLOWANCES` names the file.
 *
 * Here rather than in the web app (#488): the API names the product too — the
 * invitation and reset emails in `auth.ts`, the auto-reply's sign off — and it
 * cannot import from `apps/web`. One literal, which both apps and the E2E suite
 * read.
 */
export const BRAND_NAME = "The Great Forge Desk";
export const BRAND_SHORT = "Forge Desk";

/**
 * `BRAND_NAME` without its article, for where the name stands before a noun:
 * "Your Great Forge Desk account", not "Your The Great Forge Desk account".
 * Derived rather than restated, so nothing that reads it can drift from the
 * name. The invitation and reset emails in `auth.ts` use it, and so does the
 * auto-reply's strip of a product-name sign off the model wrote itself (#513).
 */
export const BRAND_ATTRIBUTIVE = BRAND_NAME.replace(/^The /, "");
